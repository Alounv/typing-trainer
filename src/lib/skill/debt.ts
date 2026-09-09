import type { BigramSample, ClassificationThresholds, SessionSummary } from '../support/core';
import { BIGRAM_CLASSIFICATION_WINDOW, DEFAULT_THRESHOLDS } from '../support/core';

/**
 * Clean repetitions owed before the rolling window reads as clean. Measured
 * against the same window `classifyBigram` uses, so the cost of an error is the
 * app's own definition of clean rather than a chosen penalty — one error costs
 * however many clean repeats it takes to push it out of the window.
 *
 * Occurrence count is ignored on purpose: a bigram under
 * `MIN_OCCURRENCES_FOR_CLASSIFICATION` still owes what it owes.
 */
function computeBigramDebts(
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

/**
 * Debt for every bigram the typist has actually produced, zero-debt ones
 * dropped.
 *
 * The universe comes from the history rather than the language: a bigram never
 * typed has no samples, so its debt is zero by definition, and enumerating the
 * language's thousands of pairs to learn that would be work for nothing.
 * Dropping the zeros keeps the map to what is actually owed, which is what
 * passage scoring reads.
 */
export function computeAllBigramDebts(
	sessions: readonly SessionSummary[],
	thresholds: ClassificationThresholds = DEFAULT_THRESHOLDS,
	window: number = BIGRAM_CLASSIFICATION_WINDOW
): Map<string, number> {
	const seen = new Set<string>();
	for (const session of sessions) {
		for (const agg of session.bigramAggregates) seen.add(agg.bigram);
	}

	const all = computeBigramDebts(sessions, [...seen], thresholds, window);
	for (const [bigram, debt] of all) {
		if (debt <= 0) all.delete(bigram);
	}
	return all;
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
