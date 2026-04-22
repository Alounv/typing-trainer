/**
 * Scheduler I/O types. The planner itself lives in `planner.ts`; this
 * file is kept type-only so UI components can import `PlannedSession`
 * without pulling in the planning logic.
 */
import type { PriorityBigram, SessionConfig, SessionSummary, UserSettings } from '../support/core';

/**
 * Slot-level key for completed-today accounting. Splits `bigram-drill` by
 * mode so accuracy and speed slots are counted independently.
 */
export type PlanSlotKey =
	| 'diagnostic'
	| 'bigram-drill/accuracy'
	| 'bigram-drill/speed'
	| 'real-text';

/** Drill without a mode falls back to accuracy, matching the direct-nav default. */
export function planSlotKey(config: SessionConfig): PlanSlotKey {
	if (config.type === 'bigram-drill') {
		return config.drillMode === 'speed' ? 'bigram-drill/speed' : 'bigram-drill/accuracy';
	}
	return config.type;
}

/** Session-shaped overload so callers don't reconstruct a `SessionConfig`. */
export function planSlotKeyForSession(
	session: Pick<SessionSummary, 'type' | 'drillMode'>
): PlanSlotKey {
	if (session.type === 'bigram-drill') {
		return session.drillMode === 'speed' ? 'bigram-drill/speed' : 'bigram-drill/accuracy';
	}
	return session.type;
}

export interface PlannedSession {
	config: SessionConfig;
	/** Short human-readable string for the dashboard card. */
	label: string;
	/** Optional longer "why this, why now" line. */
	rationale?: string;
	/**
	 * Drill-only provenance for `config.bigramsTargeted`: `priority` are
	 * diagnosed weaknesses, `exposure` are frequent-but-unclassified bigrams
	 * backfilled when priority is short. Flattened priority-first into the
	 * config so downstream consumers can stay source-agnostic; the UI reads
	 * this to label each target.
	 */
	drillMix?: {
		priority: string[];
		exposure: string[];
	};
}

export interface SchedulerInput {
	/**
	 * Newest-first (matching `getRecentSessions`). The planner only reads
	 * enough to decide diagnostic cadence; a window of ~20 is plenty.
	 */
	recentSessions: readonly SessionSummary[];
	/**
	 * Bigrams that the "3 consecutive healthy sessions" filter has
	 * retired from active drill rotation. Planner removes these from
	 * the drill's `bigramsTargeted` before emitting. Kept as an input
	 * (not computed here) so `planDailySessions` stays pure/sync.
	 */
	graduatedFromRotation?: ReadonlySet<string>;
	/**
	 * Class-scoped priority targets per drill. Split upstream so the accuracy
	 * drill's error-weighted ranking can't starve the fluency-only speed drill.
	 */
	accuracyPriorityTargets: readonly PriorityBigram[];
	speedPriorityTargets: readonly PriorityBigram[];
	/** Exposure-backfill pool for the accuracy drill — see `buildLiveUndertrained`. */
	undertrainedBigrams: readonly string[];
	/**
	 * How many top priority bigrams to include in a drill session. Defaults
	 * to `DEFAULT_DRILL_TARGET_COUNT`; exposed for tests and future user
	 * preference.
	 */
	drillTargetCount?: number;
	/**
	 * User profile for per-user overrides: word budgets, classification
	 * thresholds, language/corpus. Absent = factory defaults.
	 */
	userSettings?: UserSettings;
	/**
	 * Plan-window cursor (ms). When set, the planner prepends a diagnostic
	 * if the latest one on file is older than this cutoff — "Start fresh
	 * plan" wants refreshed targets. `0` / `undefined` disables the check.
	 */
	planStartedAt?: number;
}
