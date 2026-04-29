import type {
	BigramAggregate,
	BigramSample,
	ClassificationThresholds,
	KeystrokeEvent
} from '../support/core';
import { classifyBigram } from './classification';

/**
 * First-input event stream → per-bigram aggregates. Precondition: `events` is
 * first-inputs only (use `annotateFirstInputs`); retypes would double-count.
 * Errors are counted on the right-hand char to avoid double-counting across
 * adjacent bigrams. Timing draws only from clean (both-correct) samples.
 */
export function extractBigramAggregates(
	events: readonly KeystrokeEvent[],
	sessionId: string,
	thresholds?: ClassificationThresholds
): BigramAggregate[] {
	const sorted = [...events].sort((a, b) => a.position - b.position);

	interface Bucket {
		samples: BigramSample[];
	}
	const buckets = new Map<string, Bucket>();

	for (let i = 0; i < sorted.length - 1; i++) {
		const left = sorted[i];
		const right = sorted[i + 1];
		if (right.position !== left.position + 1) continue;
		// Drop fumble follow-ups (annotateFirstInputs flags them): only the first
		// wrong key in a burst counts; subsequent wrongs are noise.
		if ((right as { burstFollowUp?: boolean }).burstFollowUp) continue;

		const key = left.expected + right.expected;
		let bucket = buckets.get(key);
		if (!bucket) {
			bucket = { samples: [] };
			buckets.set(key, bucket);
		}

		const leftCorrect = left.actual === left.expected;
		const rightCorrect = right.actual === right.expected;
		bucket.samples.push({
			correct: rightCorrect,
			timing: leftCorrect && rightCorrect ? right.timestamp - left.timestamp : null
		});
	}

	const out: BigramAggregate[] = [];
	for (const [bigram, b] of buckets) {
		const cleanTimings = b.samples.map((s) => s.timing).filter((t): t is number => t !== null);
		const meanTime = mean(cleanTimings);
		const stdTime = sampleStd(cleanTimings, meanTime);
		const errorCount = b.samples.reduce((n, s) => n + (s.correct ? 0 : 1), 0);
		const occurrences = b.samples.length;
		const errorRate = errorCount / occurrences;
		out.push({
			bigram,
			sessionId,
			occurrences,
			meanTime,
			stdTime,
			errorCount,
			errorRate,
			classification: classifyBigram({ occurrences, meanTime, errorRate }, thresholds),
			samples: b.samples
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
