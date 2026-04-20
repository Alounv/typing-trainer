// Dashboard data loader. Bridges the pure planner to async storage so the
// component only handles render. Outside the component so tests don't mount.
import type { DiagnosticReport } from '../diagnostic/types';
import type { SessionSummary, SessionType } from '../session/types';
import type { UserSettings } from '../settings/profile';
import { getProfile } from '../settings/profile';
import { getBigramHistory, getRecentSessions } from '../storage/service';
import { findGraduatedBigrams } from './graduation-filter';
import { planDailySessions, sliceCompletedFromPlan } from './planner';
import { applyBonusBaseline, readActiveBaseline } from './bonus-round';
import type { PlannedSession } from './types';

/**
 * How many sessions to pull for cadence + diagnostic-lookup decisions. The
 * planner only peeks at ~10; 20 gives comfortable headroom without pulling a
 * full analytics load.
 */
const RECENT_WINDOW = 20;

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
	/**
	 * Recent-session window used for planning — exposed so the summary page
	 * (which also needs it for delta / graduation / milestone detection) can
	 * reuse the same fetch instead of doing a second one.
	 */
	recentSessions: readonly SessionSummary[];
}

export interface DashboardLoadOptions {
	/**
	 * Optional pre-fetched recent sessions. Passed in by the summary page so
	 * the delta + graduation + milestone computations share the fetch with
	 * the planner. Absent → the loader does its own read.
	 */
	recentSessions?: readonly SessionSummary[];
}

/**
 * Resolve everything the dashboard needs: planner + graduation filter +
 * latest-diagnostic-report lookup in one await. The report is read straight
 * off the most recent diagnostic's summary — computed once at save time, not
 * replayed here.
 */
export async function loadDashboardData(opts: DashboardLoadOptions = {}): Promise<DashboardData> {
	const recentSessions = opts.recentSessions ?? (await getRecentSessions(RECENT_WINDOW));

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
		userSettings,
		recentSessions
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
