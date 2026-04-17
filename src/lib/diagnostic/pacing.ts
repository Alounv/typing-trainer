import type { KeystrokeEvent } from '../typing/types';
import { TARGET_WPM_MULTIPLIER } from '../models';

/**
 * Middle-quantile trim ratio: discard the slowest and fastest deciles
 * (spec §3.3). Keeping 80% of per-word samples trims outliers — a typo-
 * riddled word or a mid-text pause — without letting a handful of
 * unusually quick or slow words dominate the baseline.
 */
const TRIM_DECILE = 0.1;

/**
 * Per-word WPM sample. Exported mainly for tests and debug inspection.
 */
export interface WordWPMSample {
	/** Word text (as typed, from `expected` — not what the user hit). */
	word: string;
	/** Characters in the word, including a trailing space if present. */
	chars: number;
	/** Ms from the word's first keystroke to its last. */
	durationMs: number;
	/** WPM for just this word (5 chars = 1 word). NaN if duration <= 0. */
	wpm: number;
}

/**
 * Baseline WPM from diagnostic event stream (spec §3.3).
 *
 * Approach:
 *   1. Bucket first-input events by `wordIndex`.
 *   2. For each word with ≥2 keystrokes, compute per-word WPM.
 *   3. Sort, discard the top and bottom decile, mean the rest.
 *
 * Returns 0 for an empty/unusable input — a baseline that we can't trust
 * should be a hard zero the UI can short-circuit on, not a misleading
 * small number.
 *
 * NOTE: callers should pass the raw diagnostic events straight from the
 * session capture. We intentionally work off the raw log (not
 * `annotateFirstInputs` output) — retypes happen within a word and we
 * care about wall-clock duration of finishing the word, not the clean-
 * samples path used by bigram timing.
 */
export function deriveBaselineWPM(events: readonly KeystrokeEvent[]): number {
	const samples = perWordWPM(events);
	const finite = samples.map((s) => s.wpm).filter((w) => Number.isFinite(w));
	if (finite.length === 0) return 0;

	const trimmed = trimDeciles(finite);
	if (trimmed.length === 0) return 0;

	let sum = 0;
	for (const w of trimmed) sum += w;
	return sum / trimmed.length;
}

/**
 * `targetWPM = baselineWPM × TARGET_WPM_MULTIPLIER` (spec §3.3).
 *
 * Deliberately a separate function rather than collapsing into
 * `deriveBaselineWPM` — the multiplier is spec-tunable and callers
 * (progress store, UI) sometimes want the raw baseline.
 */
export function computeTargetWPM(baseline: number): number {
	return baseline * TARGET_WPM_MULTIPLIER;
}

/**
 * Slice events into word-aligned buckets and compute a WPM per word.
 *
 * Visible for testing (re-exported for harness use) — not needed by
 * consumers. If you find yourself importing this from app code,
 * prefer `deriveBaselineWPM`.
 */
export function perWordWPM(events: readonly KeystrokeEvent[]): WordWPMSample[] {
	if (events.length === 0) return [];

	// Group by wordIndex preserving original ordering. Events may arrive
	// unsorted after replay-style callers concat chunks — defensive sort.
	const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);
	const buckets = new Map<number, KeystrokeEvent[]>();
	for (const e of sorted) {
		let list = buckets.get(e.wordIndex);
		if (!list) {
			list = [];
			buckets.set(e.wordIndex, list);
		}
		list.push(e);
	}

	const samples: WordWPMSample[] = [];
	for (const [, bucket] of buckets) {
		// Need at least 2 keystrokes to derive a duration. Single-char
		// "words" (accidents of the spec text) contribute nothing.
		if (bucket.length < 2) continue;

		const first = bucket[0];
		const last = bucket[bucket.length - 1];
		const durationMs = last.timestamp - first.timestamp;
		if (durationMs <= 0) continue;

		const word = bucket.map((e) => e.expected).join('');
		const chars = bucket.length;
		// 5 chars = 1 word; minutes = ms / 60_000.
		const wpm = chars / 5 / (durationMs / 60_000);
		samples.push({ word, chars, durationMs, wpm });
	}
	return samples;
}

/**
 * Drop the bottom and top deciles, keep the middle 80%. Pure — doesn't
 * mutate input. Samples fewer than 10 elements degrade to "no trim"
 * rather than clipping to empty; a short diagnostic would otherwise
 * return 0 and read as "no baseline yet" when we actually have usable
 * data.
 */
function trimDeciles(values: number[]): number[] {
	if (values.length < 10) return [...values];
	const sorted = [...values].sort((a, b) => a - b);
	const cut = Math.floor(sorted.length * TRIM_DECILE);
	return sorted.slice(cut, sorted.length - cut);
}
