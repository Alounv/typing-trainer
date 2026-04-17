import type { KeystrokeEvent } from '../typing/types';
import { TARGET_WPM_MULTIPLIER } from '../models';

/**
 * Discard slowest/fastest deciles. Keeping 80% trims outliers (typo-riddled
 * words, mid-text pauses) without letting a few unusually-fast words dominate.
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
 * Baseline WPM: bucket events by word, compute per-word WPM, trim deciles,
 * mean the rest. Returns 0 when unusable (UI short-circuits on exact zero).
 * Pass raw events — retypes contribute to the word's wall-clock duration.
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

/** `targetWPM = baselineWPM × TARGET_WPM_MULTIPLIER`. Separate because callers sometimes want the raw baseline. */
export function computeTargetWPM(baseline: number): number {
	return baseline * TARGET_WPM_MULTIPLIER;
}

/** Per-word WPM samples. Prefer `deriveBaselineWPM` in app code. */
export function perWordWPM(events: readonly KeystrokeEvent[]): WordWPMSample[] {
	if (events.length === 0) return [];

	// Defensive sort — replay-style callers may concat chunks out of order.
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
		// Need ≥2 keystrokes to derive duration; single-char words contribute nothing.
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

// Drop top/bottom deciles, keep middle 80%. <10 elements: no trim (a short
// diagnostic would otherwise clip to empty and misread as "no baseline yet").
function trimDeciles(values: number[]): number[] {
	if (values.length < 10) return [...values];
	const sorted = [...values].sort((a, b) => a - b);
	const cut = Math.floor(sorted.length * TRIM_DECILE);
	return sorted.slice(cut, sorted.length - cut);
}
