/**
 * Daily session planner (spec §5). Pure, synchronous, and side-effect
 * free: given a snapshot of recent sessions, the latest diagnostic
 * report, and the set of bigrams graduated out of rotation, decide
 * what the user should do *next*.
 *
 * Shape of the decision tree:
 *
 *   no sessions yet                     → [first-run diagnostic]
 *   no diagnostic report on file        → [catch-up diagnostic]
 *   ≥ DIAGNOSTIC_INTERVAL non-diag      → [cadence diagnostic]
 *     sessions since last diagnostic
 *   otherwise                           → [drill (5 min) → real-text (10 min)]
 *
 * The planner intentionally stays shallow: one decision per call. The
 * dashboard re-plans after each completed session so multi-day state
 * ("streaks", weekly schedules) lives elsewhere.
 */
import type { SessionConfig } from '../session/types';
import type { SchedulerInput, PlannedSession, PlannedSessionReason } from './types';

/**
 * Run a full diagnostic every N non-diagnostic sessions (spec §5).
 * Kept as a named constant so tests (and a future settings override)
 * can tune it without string-matching the rule.
 */
export const DIAGNOSTIC_INTERVAL = 7;

/** Default "top N" priority bigrams to drill per session. */
export const DEFAULT_DRILL_TARGET_COUNT = 10;

/** Durations (ms) — driven by spec §5 table. Runner may end earlier. */
export const DRILL_DURATION_MS = 5 * 60_000;
export const REALTEXT_DURATION_MS = 10 * 60_000;
/**
 * Diagnostic has no strict time cap — the session ends when the text
 * runs out (spec §2.8). This is a nominal upper bound the runner uses
 * for timeout safety; the passage length is what actually controls the
 * duration.
 */
export const DIAGNOSTIC_DURATION_MS = 10 * 60_000;

export function planDailySessions(input: SchedulerInput): PlannedSession[] {
	const {
		recentSessions,
		latestDiagnosticReport,
		graduatedFromRotation,
		drillTargetCount = DEFAULT_DRILL_TARGET_COUNT
	} = input;

	// 1. First-run: user has never completed a session. Onboarding needs
	//    a diagnostic before it can compute baseline WPM (spec §7.2).
	if (recentSessions.length === 0) {
		return [diagnosticPlan('first-run-diagnostic')];
	}

	// 2. We have sessions but no diagnostic report on file — can happen
	//    if the user deleted the diagnostic session manually, or
	//    migrated from an older schema. Fail safe with a fresh
	//    diagnostic so the drill has priority targets to pull from.
	if (!latestDiagnosticReport) {
		return [diagnosticPlan('missing-report-diagnostic')];
	}

	// 3. Cadence rule: every DIAGNOSTIC_INTERVAL non-diagnostic sessions,
	//    re-run the diagnostic so thresholds and priority targets stay
	//    current (spec §5).
	const since = sessionsSinceLastDiagnostic(recentSessions);
	if (since >= DIAGNOSTIC_INTERVAL) {
		return [diagnosticPlan('cadence-diagnostic', since)];
	}

	// 4. Default daily = drill + real text.
	const drillTargets = selectDrillTargets(
		latestDiagnosticReport.priorityTargets.map((p) => p.bigram),
		graduatedFromRotation,
		drillTargetCount
	);

	// If every priority target has graduated out of rotation, skip the
	// drill phase entirely and jump to real text — there's nothing to
	// drill on. The user has "arrived" at the current target roster.
	if (drillTargets.length === 0) {
		return [realtextPlan('no-targets-left')];
	}

	return [drillPlan(drillTargets), realtextPlan()];
}

/**
 * How many non-diagnostic sessions sit between "now" and the most
 * recent diagnostic in `recentSessions`. `recentSessions` is newest-
 * first; we walk until we hit a diagnostic row and count everything
 * above it. If no diagnostic is in the window, we return `Infinity`
 * — the caller treats that as "definitely due".
 */
function sessionsSinceLastDiagnostic(recent: readonly { type: string }[]): number {
	for (let i = 0; i < recent.length; i++) {
		if (recent[i].type === 'diagnostic') return i;
	}
	return Number.POSITIVE_INFINITY;
}

/**
 * Strip graduated bigrams from the priority list and cap at `count`.
 * Order-preserving so the highest-priority survivors stay first —
 * mirrors `DiagnosticReport.priorityTargets` ordering.
 */
function selectDrillTargets(
	priorityBigrams: readonly string[],
	graduated: ReadonlySet<string> | undefined,
	count: number
): string[] {
	const filter = graduated ?? new Set<string>();
	const out: string[] = [];
	for (const b of priorityBigrams) {
		if (filter.has(b)) continue;
		out.push(b);
		if (out.length >= count) break;
	}
	return out;
}

function diagnosticPlan(
	reason: Extract<
		PlannedSessionReason,
		'first-run-diagnostic' | 'cadence-diagnostic' | 'missing-report-diagnostic'
	>,
	sessionsSince?: number
): PlannedSession {
	const config: SessionConfig = {
		type: 'diagnostic',
		durationMs: DIAGNOSTIC_DURATION_MS
	};
	const labels: Record<typeof reason, string> = {
		'first-run-diagnostic': 'First diagnostic',
		'cadence-diagnostic': 'Weekly diagnostic',
		'missing-report-diagnostic': 'Diagnostic'
	};
	const rationales: Record<typeof reason, string> = {
		'first-run-diagnostic': 'Establishes your baseline WPM and highlights which bigrams to drill.',
		'cadence-diagnostic':
			sessionsSince !== undefined
				? `${sessionsSince} sessions since your last diagnostic — time to refresh targets.`
				: 'Refreshes your drill targets and baseline.',
		'missing-report-diagnostic':
			'No diagnostic on file — running one now so drills have current targets.'
	};
	return {
		config,
		reason,
		label: labels[reason],
		rationale: rationales[reason]
	};
}

function drillPlan(targets: string[]): PlannedSession {
	const config: SessionConfig = {
		type: 'bigram-drill',
		durationMs: DRILL_DURATION_MS,
		bigramsTargeted: targets,
		pacerEnabled: true
	};
	return {
		config,
		reason: 'default-drill',
		label: 'Bigram drill',
		rationale: `Targeted practice on your ${targets.length} weakest bigrams.`
	};
}

function realtextPlan(hint?: 'no-targets-left'): PlannedSession {
	const config: SessionConfig = {
		type: 'real-text',
		durationMs: REALTEXT_DURATION_MS,
		pacerEnabled: true
	};
	return {
		config,
		reason: 'default-realtext',
		label: 'Real text',
		rationale:
			hint === 'no-targets-left'
				? 'No drill targets remain — keeping fluency sharp with paced prose.'
				: 'Transfer drill gains into everyday typing.'
	};
}
