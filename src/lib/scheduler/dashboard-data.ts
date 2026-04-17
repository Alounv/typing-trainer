// Dashboard data loader. Bridges the pure planner to async storage so the
// component only handles render. Outside the component so tests don't mount.
import type { DiagnosticReport } from '../diagnostic/types';
import type { SessionSummary, SessionType } from '../session/types';
import type { UserSettings } from '../models';
import { getBigramHistory, getProfile } from '../storage/service';
import { findGraduatedBigrams } from './graduation-filter';
import { planDailySessions, sliceCompletedFromPlan } from './planner';
import { applyBonusBaseline, readActiveBaseline } from './bonus-round';
import type { PlannedSession } from './types';

export interface DashboardData {
	/** Plan with completed-today items stripped. Empty = done for today. */
	plan: PlannedSession[];
	/** Named boolean so UI branches on intent, not array-length arithmetic. */
	allDoneForToday: boolean;
	/** Raw completed-today counts — needed for "Start another round" bonus baseline. */
	completedToday: Partial<Record<SessionType, number>>;
	lastSession?: SessionSummary;
	latestDiagnosticReport?: DiagnosticReport;
	graduatedFromRotation: ReadonlySet<string>;
	userSettings?: UserSettings;
}

export interface DashboardLoadInputs {
	recentSessions: readonly SessionSummary[];
}

/**
 * Resolve everything the dashboard needs: planner + graduation filter +
 * latest-diagnostic-report lookup in one await. The report is read straight
 * off the most recent diagnostic's summary — computed once at save time, not
 * replayed here.
 */
export async function loadDashboardData(inputs: DashboardLoadInputs): Promise<DashboardData> {
	const { recentSessions } = inputs;

	const latestDiagnosticReport = findLatestDiagnosticReport(recentSessions);
	const userSettings = await getProfile();

	const priorityBigrams = latestDiagnosticReport?.priorityTargets.map((p) => p.bigram) ?? [];
	const graduatedFromRotation = await findGraduatedBigrams(priorityBigrams, getBigramHistory);

	const fullPlan = planDailySessions({
		recentSessions,
		latestDiagnosticReport,
		graduatedFromRotation,
		userSettings
	});

	// Strip done-today from the planner's stateless full-day output. Bonus
	// round (if active) subtracts its baseline first → earlier completions
	// are "forgiven" and the user gets a fresh plan.
	const completedToday = countCompletedToday(recentSessions);
	const effectiveCompleted = applyBonusBaseline(completedToday, readActiveBaseline());
	const plan = sliceCompletedFromPlan(fullPlan, effectiveCompleted);

	return {
		plan,
		allDoneForToday: plan.length === 0 && fullPlan.length > 0,
		completedToday,
		lastSession: recentSessions[0],
		latestDiagnosticReport,
		graduatedFromRotation,
		userSettings
	};
}

// Count sessions per type finished today. "Today" = local calendar day — a rolling
// 24h window would keep yesterday's late session counted against tomorrow's plan.
function countCompletedToday(
	sessions: readonly SessionSummary[]
): Partial<Record<SessionType, number>> {
	const today = new Date().toDateString();
	const out: Partial<Record<SessionType, number>> = {};
	for (const s of sessions) {
		if (new Date(s.timestamp).toDateString() !== today) continue;
		out[s.type] = (out[s.type] ?? 0) + 1;
	}
	return out;
}

// Pull the most recent diagnostic's attached report. `undefined` when no
// diagnostic exists, or when the diagnostic predates v2 (no report persisted)
// — planner treats both as "missing report" and schedules a fresh diagnostic.
function findLatestDiagnosticReport(
	recentSessions: readonly SessionSummary[]
): DiagnosticReport | undefined {
	const latestDiag = recentSessions.find((s) => s.type === 'diagnostic');
	return latestDiag?.diagnosticReport;
}
