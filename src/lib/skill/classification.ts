import {
	DEFAULT_THRESHOLDS,
	MIN_OCCURRENCES_FOR_CLASSIFICATION,
	type BigramAggregate,
	type BigramClassification,
	type ClassificationThresholds
} from '../support/core';

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
