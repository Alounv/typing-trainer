import type { BigramAggregate, BigramClassification } from '../core';

export const DEFAULT_SPEED_THRESHOLD_MS = 150;
export const DEFAULT_HIGH_ERROR_THRESHOLD = 0.05;

/** Thresholds driving the 4-way classification. `UserSettings.thresholds` overrides. */
export interface ClassificationThresholds {
	/** Mean transition time at/under which a bigram counts as fast (ms). */
	speedMs: number;
	/** Error rate at/above which a bigram counts as error-prone (0..1). */
	errorRate: number;
}

export const DEFAULT_THRESHOLDS: ClassificationThresholds = {
	speedMs: DEFAULT_SPEED_THRESHOLD_MS,
	errorRate: DEFAULT_HIGH_ERROR_THRESHOLD
};

/**
 * Minimum occurrences before the four-way classification applies. Below this,
 * bigrams are `unclassified` (undertrained) rather than guessed.
 */
export const MIN_OCCURRENCES_FOR_CLASSIFICATION = 10;

/** Classifies a bigram against thresholds. `fast` is `≤`, `clean` is strict `<` — boundaries are asymmetric by design. */
export function classifyBigram(
	aggregate: Pick<BigramAggregate, 'occurrences' | 'meanTime' | 'errorRate'>,
	thresholds: ClassificationThresholds = DEFAULT_THRESHOLDS
): BigramClassification {
	if (aggregate.occurrences < MIN_OCCURRENCES_FOR_CLASSIFICATION) return 'unclassified';
	// No clean timing samples → can't classify speed.
	if (!Number.isFinite(aggregate.meanTime)) return 'unclassified';

	const fast = aggregate.meanTime <= thresholds.speedMs;
	const clean = aggregate.errorRate < thresholds.errorRate;

	if (fast && clean) return 'healthy';
	if (fast && !clean) return 'hasty';
	if (!fast && clean) return 'fluency';
	return 'acquisition';
}
