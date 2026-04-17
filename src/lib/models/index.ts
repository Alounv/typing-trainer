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
	/**
	 * Per-user override of the `DEFAULT_*_WORD_BUDGET` constants. Absent
	 * keys fall back to the defaults; omitting the whole object is the
	 * same as the factory setup. Settings page surfaces the three
	 * knobs together so a power user can tune session length.
	 */
	wordBudgets?: {
		bigramDrill: number;
		realText: number;
		diagnostic: number;
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
 * Default word budgets per session type. Intentionally small so a
 * session is a mini-workout: <1 min at 60 WPM. Each completion is its
 * own checkpoint — abandoning mid-session loses at most a minute of
 * data, and the daily plan chains several of them together. Advanced
 * users can override via `UserSettings` (Phase 6.5).
 */
export const DEFAULT_BIGRAM_DRILL_WORD_BUDGET = 15;
export const DEFAULT_REAL_TEXT_WORD_BUDGET = 25;
/**
 * Diagnostic needs enough surface area to hit ≥15 occurrences of top-200
 * bigrams (spec §2.8); sized generously to guarantee coverage. Stays
 * one large sample — fragmenting would starve the classifier.
 */
export const DEFAULT_DIAGNOSTIC_WORD_BUDGET = 200;
