export type Language = 'en' | 'fr';

/** Persistent user configuration. */
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
	/** Per-user override of `DEFAULT_*_WORD_BUDGET`. Absent keys fall back to defaults. */
	wordBudgets?: {
		bigramDrill: number;
		realText: number;
		diagnostic: number;
	};
}

/** Mean transition time at/under which a bigram counts as fast. */
export const DEFAULT_SPEED_THRESHOLD_MS = 150;

/** Error rate at/above which a bigram counts as error-prone. */
export const DEFAULT_HIGH_ERROR_THRESHOLD = 0.05;

/** `targetWPM = baselineWPM × this`. 1.17 is modest — reachable, not punitive. */
export const TARGET_WPM_MULTIPLIER = 1.17;

/**
 * Default word budgets — small so a session is a mini-workout (<1 min at 60 WPM)
 * and every completion is a checkpoint. Overridable via `UserSettings`.
 */
export const DEFAULT_BIGRAM_DRILL_WORD_BUDGET = 15;
export const DEFAULT_REAL_TEXT_WORD_BUDGET = 25;
/** Sized for ≥15 occurrences of top-200 bigrams; one large sample not fragmented. */
export const DEFAULT_DIAGNOSTIC_WORD_BUDGET = 200;
