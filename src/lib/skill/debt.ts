import type { BigramSample, ClassificationThresholds, SessionSummary } from '../support/core';
import { BIGRAM_CLASSIFICATION_WINDOW, DEFAULT_THRESHOLDS } from '../support/core';

/**
 * Clean repetitions each bigram still owes before its rolling window reads as
 * clean. The window is the same one `classifyBigram` reads, so the answer is
 * the app's own definition of clean rather than a chosen penalty: with a
 * twenty-sample window and a strict `errorRate < 0.05`, a single error costs up
 * to a full window of clean repeats — exactly as many as it takes to push that
 * error out.
 *
 * Occurrence count is deliberately ignored: an `unclassified` bigram (under
 * `MIN_OCCURRENCES_FOR_CLASSIFICATION`) still owes the repeats it owes.
 */
export function computeBigramDebts(
	sessions: readonly SessionSummary[],
	bigrams: readonly string[],
	thresholds: ClassificationThresholds = DEFAULT_THRESHOLDS,
	window: number = BIGRAM_CLASSIFICATION_WINDOW
): Map<string, number> {
	const wanted = new Set(bigrams);
	const pooled = poolNewestFirst(sessions, wanted, window);

	const out = new Map<string, number>();
	for (const bigram of wanted) {
		out.set(bigram, debtFor(pooled.get(bigram) ?? [], thresholds.errorRate, window));
	}
	return out;
}

/** Newest sample first, capped at `window` per bigram. */
function poolNewestFirst(
	sessions: readonly SessionSummary[],
	wanted: ReadonlySet<string>,
	window: number
): Map<string, BigramSample[]> {
	const out = new Map<string, BigramSample[]>();
	const newestFirst = [...sessions].sort((a, b) => b.timestamp - a.timestamp);
	for (const session of newestFirst) {
		for (const agg of session.bigramAggregates) {
			if (!wanted.has(agg.bigram) || !agg.samples) continue;
			let buffer = out.get(agg.bigram);
			if (!buffer) {
				buffer = [];
				out.set(agg.bigram, buffer);
			}
			for (let i = agg.samples.length - 1; i >= 0 && buffer.length < window; i--) {
				buffer.push(agg.samples[i]);
			}
		}
	}
	return out;
}

/**
 * Smallest number of clean repeats that brings the window under the threshold.
 * Each one enters at the newest end and pushes the oldest sample out, so errors
 * age out of the window one repeat at a time.
 */
function debtFor(
	newestFirst: readonly BigramSample[],
	maxErrorRate: number,
	window: number
): number {
	for (let clean = 0; clean < window; clean++) {
		const kept = newestFirst.slice(0, Math.max(0, window - clean));
		const size = clean + kept.length;
		if (size === 0) return 0;
		const errors = kept.reduce((n, s) => n + (s.correct ? 0 : 1), 0);
		if (errors / size < maxErrorRate) return clean;
	}
	return window;
}
