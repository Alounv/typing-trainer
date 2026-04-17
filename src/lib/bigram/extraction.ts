import type { KeystrokeEvent } from '../typing/types';
import type { BigramAggregate } from './types';
import { classifyBigram, type ClassificationThresholds } from './classification';

/**
 * Turn a first-input-per-position event stream into per-bigram aggregates.
 *
 * **Precondition**: input events are first-inputs only (one per position)
 * — typically the output of `annotateFirstInputs`. Passing the raw capture
 * log with retypes would double-count. The function sorts defensively by
 * `position` but does not dedupe.
 *
 * For each adjacent pair (position i, position i+1):
 * - `bigram` keyed on the _expected_ characters (what should have been typed)
 * - `occurrences` counts every pair encountered
 * - `errorCount` counts first-input errors on the **right-hand char** (i+1) —
 *   standard convention; prevents double-counting a wrong char across the
 *   two bigrams it participates in
 * - `meanTime` / `stdTime` draw only from pairs where **both** first inputs
 *   matched expected (clean samples). Error samples pollute the motor-program
 *   timing signal; we exclude them.
 *
 * Non-consecutive positions (e.g. gaps from aborted sessions) are skipped
 * rather than forming a spurious bigram.
 */
export function extractBigramAggregates(
	events: readonly KeystrokeEvent[],
	sessionId: string,
	thresholds?: ClassificationThresholds
): BigramAggregate[] {
	const sorted = [...events].sort((a, b) => a.position - b.position);

	interface Bucket {
		occurrences: number;
		errorCount: number;
		cleanTimings: number[];
	}
	const buckets = new Map<string, Bucket>();

	for (let i = 0; i < sorted.length - 1; i++) {
		const left = sorted[i];
		const right = sorted[i + 1];
		if (right.position !== left.position + 1) continue;

		const key = left.expected + right.expected;
		let bucket = buckets.get(key);
		if (!bucket) {
			bucket = { occurrences: 0, errorCount: 0, cleanTimings: [] };
			buckets.set(key, bucket);
		}

		bucket.occurrences++;
		if (right.actual !== right.expected) bucket.errorCount++;

		const leftCorrect = left.actual === left.expected;
		const rightCorrect = right.actual === right.expected;
		if (leftCorrect && rightCorrect) {
			bucket.cleanTimings.push(right.timestamp - left.timestamp);
		}
	}

	const out: BigramAggregate[] = [];
	for (const [bigram, b] of buckets) {
		const meanTime = mean(b.cleanTimings);
		const stdTime = sampleStd(b.cleanTimings, meanTime);
		const errorRate = b.errorCount / b.occurrences;
		out.push({
			bigram,
			sessionId,
			occurrences: b.occurrences,
			meanTime,
			stdTime,
			errorCount: b.errorCount,
			errorRate,
			classification: classifyBigram(
				{ occurrences: b.occurrences, meanTime, errorRate },
				thresholds
			)
		});
	}
	return out;
}

/** Arithmetic mean, or NaN for an empty sample (propagates to classification). */
function mean(xs: number[]): number {
	if (xs.length === 0) return NaN;
	let sum = 0;
	for (const x of xs) sum += x;
	return sum / xs.length;
}

/** Sample standard deviation (n-1). Zero for < 2 samples — no variance to measure. */
function sampleStd(xs: number[], m: number): number {
	if (xs.length < 2) return 0;
	let sumSq = 0;
	for (const x of xs) sumSq += (x - m) ** 2;
	return Math.sqrt(sumSq / (xs.length - 1));
}
