/**
 * Dashboard data loader. Bridges the scheduler's pure planner to the
 * async storage + corpus layer so `+page.svelte` only has to deal with
 * its own render logic.
 *
 * Kept outside the Svelte component so tests can exercise the full
 * load path without mounting.
 */
import type { DiagnosticReport } from '../diagnostic/types';
import type { SessionSummary } from '../session/types';
import type { CorpusData } from '../corpus/types';
import { generateDiagnosticReport } from '../diagnostic/engine';
import { getDiagnosticRawData, getBigramHistory } from '../storage/service';
import { findGraduatedBigrams } from './graduation-filter';
import { planDailySessions } from './planner';
import type { PlannedSession } from './types';

export interface DashboardData {
	plan: PlannedSession[];
	lastSession?: SessionSummary;
	latestDiagnosticReport?: DiagnosticReport;
	graduatedFromRotation: ReadonlySet<string>;
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

	const latestDiagnosticReport = await reconstructLatestDiagnosticReport(recentSessions, corpus);

	const priorityBigrams = latestDiagnosticReport?.priorityTargets.map((p) => p.bigram) ?? [];
	const graduatedFromRotation = await findGraduatedBigrams(priorityBigrams, getBigramHistory);

	const plan = planDailySessions({
		recentSessions,
		latestDiagnosticReport,
		graduatedFromRotation
	});

	return {
		plan,
		lastSession: recentSessions[0],
		latestDiagnosticReport,
		graduatedFromRotation
	};
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
