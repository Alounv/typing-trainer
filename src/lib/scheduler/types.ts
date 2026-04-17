/**
 * Scheduler I/O types. The planner itself lives in `planner.ts`; this
 * file is kept type-only so UI components can import `PlannedSession`
 * without pulling in the planning logic.
 */
import type { SessionConfig, SessionSummary } from '../session/types';
import type { DiagnosticReport } from '../diagnostic/types';

/**
 * Why the planner emitted a given entry. Drives the dashboard copy
 * ("Time for your weekly diagnostic", "Warm-up drill", …) and lets
 * tests assert behavior without string-matching UI labels.
 */
export type PlannedSessionReason =
	| 'first-run-diagnostic'
	| 'cadence-diagnostic'
	| 'missing-report-diagnostic'
	| 'default-drill'
	| 'default-realtext';

export interface PlannedSession {
	config: SessionConfig;
	reason: PlannedSessionReason;
	/** Short human-readable string for the dashboard card. */
	label: string;
	/** Optional longer "why this, why now" line. */
	rationale?: string;
}

export interface SchedulerInput {
	/**
	 * Newest-first (matching `getRecentSessions`). The planner only reads
	 * enough to decide diagnostic cadence; a window of ~20 is plenty.
	 */
	recentSessions: readonly SessionSummary[];
	/**
	 * The most recent diagnostic's report. Drives drill target selection.
	 * `undefined` when the user has never completed a diagnostic — the
	 * planner then inserts one.
	 */
	latestDiagnosticReport?: DiagnosticReport;
	/**
	 * Bigrams that the "3 consecutive healthy sessions" filter has
	 * retired from active drill rotation. Planner removes these from
	 * the drill's `bigramsTargeted` before emitting. Kept as an input
	 * (not computed here) so `planDailySessions` stays pure/sync.
	 */
	graduatedFromRotation?: ReadonlySet<string>;
	/**
	 * How many top priority bigrams to include in a drill session. Defaults
	 * to `DEFAULT_DRILL_TARGET_COUNT`; exposed for tests and future user
	 * preference.
	 */
	drillTargetCount?: number;
}
