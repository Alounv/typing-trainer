/**
 * Dashboard data loader. Bridges the scheduler's pure planner to the
 * async storage + corpus layer so `+page.svelte` only has to deal with
 * its own render logic.
 *
 * Kept outside the Svelte component so tests can exercise the full
 * load path without mounting.
 */
import type { DiagnosticReport } from '../diagnostic/types';
import type { SessionSummary, SessionType } from '../session/types';
import type { CorpusData } from '../corpus/types';
import type { UserSettings } from '../models';
import { generateDiagnosticReport } from '../diagnostic/engine';
import { getDiagnosticRawData, getBigramHistory, getProfile } from '../storage/service';
import { findGraduatedBigrams } from './graduation-filter';
import { planDailySessions, sliceCompletedFromPlan } from './planner';
import type { PlannedSession } from './types';

export interface DashboardData {
	/**
	 * Plan with already-completed-today items stripped off the front.
	 * Empty array means the user has finished today's workout.
	 */
	plan: PlannedSession[];
	/**
	 * True when the full day's plan has been completed. Distinct from
	 * `plan.length === 0` only in theory (they always agree here), but
	 * surfaced as a named boolean so UI code can branch on intent
	 * rather than array-length arithmetic.
	 */
	allDoneForToday: boolean;
	lastSession?: SessionSummary;
	latestDiagnosticReport?: DiagnosticReport;
	graduatedFromRotation: ReadonlySet<string>;
	userSettings?: UserSettings;
}

export interface DashboardLoadInputs {
	recentSessions: readonly SessionSummary[];
	/**
	 * Loaded corpus for enriching the diagnostic report's corpusFit.
	 * Optional — the report works without it, just with `coverageRatio: 0`.
	 */
	corpus?: CorpusData;
}

/**
 * Resolve everything the dashboard needs to render the "today's plan"
 * card plus last-session chip. Composes planner + graduation filter +
 * diagnostic-report reconstruction into one await.
 *
 * Why reconstruct the report instead of persisting it: the raw events
 * are already stored (spec §2.8) and classification thresholds are
 * tunable — re-running `generateDiagnosticReport` keeps the report in
 * sync with whatever the thresholds say today, not what they said at
 * diagnostic time.
 */
export async function loadDashboardData(inputs: DashboardLoadInputs): Promise<DashboardData> {
	const { recentSessions, corpus } = inputs;

	// Profile read runs in parallel with the diagnostic-report
	// rebuild: they're independent reads, and the dashboard blocks on
	// all of them before first paint anyway.
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

	// Strip already-done-today items so the dashboard only shows what's
	// left. Planner is stateless and always emits a full day; the "what
	// the user has already done" filter lives here, at the async edge
	// that knows about clocks and storage.
	const completedToday = countCompletedToday(recentSessions);
	const plan = sliceCompletedFromPlan(fullPlan, completedToday);

	return {
		plan,
		allDoneForToday: plan.length === 0 && fullPlan.length > 0,
		lastSession: recentSessions[0],
		latestDiagnosticReport,
		graduatedFromRotation,
		userSettings
	};
}

/**
 * Count how many of each session type the user has already finished
 * today. "Today" = local calendar day (via `Date.toDateString()`) —
 * matches user intuition better than a rolling 24h window, which would
 * e.g. keep yesterday's 11pm session counted against tomorrow's plan.
 */
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

/**
 * Pull the most-recent diagnostic's raw events back out of storage and
 * rebuild its report. Returns `undefined` when there is no diagnostic
 * on file — the planner treats that as "first-run, issue a diagnostic".
 */
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
