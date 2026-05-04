import {
	DEFAULT_THRESHOLDS,
	MIN_OCCURRENCES_FOR_CLASSIFICATION,
	type BigramAggregate,
	type BigramClassification,
	type BigramSample,
	type ClassificationThresholds
} from '../support/core';

/** Reduces a sample buffer to the (meanTime, errorRate) pair `classifyBigram` consumes.
 *  `meanTime` is `NaN` when no clean timing samples exist; `errorRate` is the share of
 *  incorrect samples in the buffer. */
export function summarizeSamples(samples: readonly BigramSample[]): {
	meanTime: number;
	errorRate: number;
} {
	let timingSum = 0;
	let timingCount = 0;
	let errorCount = 0;
	for (const s of samples) {
		if (s.timing !== null) {
			timingSum += s.timing;
			timingCount++;
		}
		if (!s.correct) errorCount++;
	}
	return {
		meanTime: timingCount === 0 ? NaN : timingSum / timingCount,
		errorRate: samples.length === 0 ? 0 : errorCount / samples.length
	};
}

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
