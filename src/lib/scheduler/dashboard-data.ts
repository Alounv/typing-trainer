// Dashboard data loader. Bridges the pure planner to async storage + corpus
// so the component only handles render. Outside the component so tests don't mount.
import type { DiagnosticReport } from '../diagnostic/types';
import type { SessionSummary, SessionType } from '../session/types';
import type { CorpusData } from '../corpus/types';
import type { UserSettings } from '../models';
import { generateDiagnosticReport } from '../diagnostic/engine';
import { getDiagnosticRawData, getBigramHistory, getProfile } from '../storage/service';
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
	/** Optional corpus for corpusFit enrichment; without it, `coverageRatio: 0`. */
	corpus?: CorpusData;
}

/**
 * Resolve everything the dashboard needs: planner + graduation filter +
 * diagnostic-report reconstruction in one await. The report is rebuilt (not
 * persisted) so tunable thresholds stay in sync with today's classification.
 */
export async function loadDashboardData(inputs: DashboardLoadInputs): Promise<DashboardData> {
	const { recentSessions, corpus } = inputs;

	// Parallel: independent reads, dashboard blocks on all before first paint.
	const [latestDiagnosticReport, userSettings] = await Promise.all([
		reconstructLatestDiagnosticReport(recentSessions, corpus),
		getProfile()
	]);

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

// Rebuild the latest diagnostic's report from stored raw events. `undefined`
// when no diagnostic on file → planner treats as "first-run".
async function reconstructLatestDiagnosticReport(
	recentSessions: readonly SessionSummary[],
	corpus: CorpusData | undefined
): Promise<DiagnosticReport | undefined> {
	const latestDiag = recentSessions.find((s) => s.type === 'diagnostic');
	if (!latestDiag) return undefined;

	const raw = await getDiagnosticRawData(latestDiag.id);
	if (!raw) return undefined;

	return generateDiagnosticReport({
		sessionId: latestDiag.id,
		timestamp: latestDiag.timestamp,
		events: raw.events,
		aggregates: latestDiag.bigramAggregates,
		corpusBigramFrequencies: corpus?.bigramFrequencies
	});
}
