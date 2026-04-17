export type Language = 'en' | 'fr';

/** Persistent user configuration (spec §2.4). */
export interface UserSettings {
	/** Ordered by priority — first entry drives default corpus selection. */
	languages: Language[];
	/** One `CorpusConfig.id` per entry in `languages`. */
	corpusIds: string[];
	/** Per-user override of the defaults below. Advanced users only. */
	thresholds?: {
		speedMs: number;
		errorRate: number;
	};
}

/** Mean transition time at/under which a bigram counts as fast (spec §3.1). */
export const DEFAULT_SPEED_THRESHOLD_MS = 150;

/** Error rate at/above which a bigram counts as error-prone (spec §3.1). */
export const DEFAULT_HIGH_ERROR_THRESHOLD = 0.05;

/**
 * `targetWPM = baselineWPM × this` (spec §3.3). 1.17 is deliberately modest
 * — speed bursts should feel reachable, not punitive.
 */
export const TARGET_WPM_MULTIPLIER = 1.17;

/**
 * Default word budgets per session type. Picked so a typical user gets
 * ~2–3 minutes per drill, ~5 minutes per real-text session at 60 WPM —
 * enough for meaningful practice without feeling like a slog. Advanced
 * users can override via `UserSettings` (Phase 6.5).
 */
export const DEFAULT_BIGRAM_DRILL_WORD_BUDGET = 50;
export const DEFAULT_REAL_TEXT_WORD_BUDGET = 100;
/**
 * Diagnostic needs enough surface area to hit ≥15 occurrences of top-200
 * bigrams (spec §2.8); sized generously to guarantee coverage.
 */
export const DEFAULT_DIAGNOSTIC_WORD_BUDGET = 200;

/**
 * Drills and real-text sessions split into N equal-ish rounds with a
 * brief auto-advancing transition between them — gives the user
 * intermediate milestones instead of one long undifferentiated block.
 * 4 is the sweet spot: enough structure to feel progress, few enough
 * transitions that they don't break flow.
 */
export const DEFAULT_ROUND_COUNT = 4;
/**
 * Diagnostic stays single-round: it's a measurement, not a workout.
 * Splitting the sample would fragment the bigram-occurrence counts that
 * §2.8 relies on.
 */
export const DIAGNOSTIC_ROUND_COUNT = 1;
