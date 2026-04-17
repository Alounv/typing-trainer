import type { BigramAggregate, BigramClassification } from './types';
import { DEFAULT_HIGH_ERROR_THRESHOLD, DEFAULT_SPEED_THRESHOLD_MS } from '../models';

/**
 * Thresholds that drive the 4-way classification. Spec §3.1 calls them
 * configurable; `UserSettings.thresholds` is the per-user override path.
 */
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
 * Minimum occurrences required before the four-way classification applies
 * (spec §3.1 — "≥10 for classification, ≥20 for stability"). Below this
 * we surface `unclassified` so callers can treat the bigram as
 * undertrained rather than guessing.
 */
export const MIN_OCCURRENCES_FOR_CLASSIFICATION = 10;

/**
 * Pure classification of a single bigram aggregate (spec §3.1). Boundary
 * semantics:
 *   meanTime  ≤ speedMs   → fast  (otherwise slow)
 *   errorRate <  errorRate → clean (otherwise error-prone)
 *
 * Yes, the thresholds are inclusive on one side and strict on the other —
 * that matches the spec's tabular definition. Table-driven tests pin this
 * behavior on the exact-threshold inputs.
 */
export function classifyBigram(
	aggregate: Pick<BigramAggregate, 'occurrences' | 'meanTime' | 'errorRate'>,
	thresholds: ClassificationThresholds = DEFAULT_THRESHOLDS
): BigramClassification {
	if (aggregate.occurrences < MIN_OCCURRENCES_FOR_CLASSIFICATION) return 'unclassified';
	// NaN/Infinity meanTime means no clean timing samples landed for this
	// bigram — every occurrence had a first-input error somewhere in the pair.
	// Can't classify speed without a timing signal, so hold off.
	if (!Number.isFinite(aggregate.meanTime)) return 'unclassified';

	const fast = aggregate.meanTime <= thresholds.speedMs;
	const clean = aggregate.errorRate < thresholds.errorRate;

	if (fast && clean) return 'healthy';
	if (fast && !clean) return 'hasty';
	if (!fast && clean) return 'fluency';
	return 'acquisition';
}
