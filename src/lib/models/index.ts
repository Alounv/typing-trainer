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
