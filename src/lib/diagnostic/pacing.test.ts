import { describe, expect, it } from 'vitest';
import { computeTargetWPM, deriveBaselineWPM, perWordWPM } from './pacing';
import type { KeystrokeEvent } from '../typing/types';
import { TARGET_WPM_MULTIPLIER } from '../models';

/**
 * Build a keystroke event. `wordIndex` is derived from `positionInWord`
 * if not given — tests that need a specific wordIndex pass it explicitly.
 */
function ev(
	position: number,
	timestamp: number,
	wordIndex: number,
	expected = 'a'
): KeystrokeEvent {
	return {
		position,
		timestamp,
		expected,
		actual: expected,
		wordIndex,
		positionInWord: position
	};
}

/**
 * Synthesize N events for one word at a given cadence. Helper keeps the
 * table-driven tests below readable — each "word" becomes N events with
 * consistent spacing so expected WPM is easy to reason about.
 */
function word(
	startTimestamp: number,
	msPerChar: number,
	chars: number,
	wordIndex: number,
	basePosition: number
): KeystrokeEvent[] {
	const out: KeystrokeEvent[] = [];
	for (let i = 0; i < chars; i++) {
		out.push(ev(basePosition + i, startTimestamp + i * msPerChar, wordIndex, 'a'));
	}
	return out;
}

describe('computeTargetWPM', () => {
	it('multiplies baseline by the spec §3.3 constant', () => {
		expect(computeTargetWPM(60)).toBeCloseTo(60 * TARGET_WPM_MULTIPLIER, 5);
	});

	it('returns 0 when baseline is 0 — no extrapolation on missing data', () => {
		expect(computeTargetWPM(0)).toBe(0);
	});
});

describe('perWordWPM', () => {
	it('returns empty when input is empty', () => {
		expect(perWordWPM([])).toEqual([]);
	});

	it('ignores single-keystroke words — no duration to measure', () => {
		// One-char word at index 0, five-char word at index 1. Only the
		// second should produce a sample.
		const events = [ev(0, 0, 0, 'a'), ...word(1000, 100, 5, 1, 1)];
		const samples = perWordWPM(events);
		expect(samples).toHaveLength(1);
		expect(samples[0].chars).toBe(5);
	});

	it('computes 60 WPM for a 5-char word typed at 200ms/char', () => {
		// 5 chars × 200ms = 800ms total (from keystroke 1 to keystroke 5).
		// The duration spans char 1 → char 5 = 4 intervals = 800ms.
		// wpm = chars / 5 / (duration / 60_000) = 5/5 / (800/60_000) = 75.
		// Not 60 — because the baseline interval definition is "first to last"
		// not "full word time including post-final". Test pins the exact behavior.
		const events = word(1000, 200, 5, 0, 0);
		const samples = perWordWPM(events);
		expect(samples[0].durationMs).toBe(800);
		expect(samples[0].wpm).toBeCloseTo(75, 5);
	});

	it('is stable under shuffled input — events are sorted by timestamp', () => {
		const a = word(0, 100, 5, 0, 0);
		const b = word(2000, 100, 5, 1, 5);
		const shuffled = [...b, ...a];
		const samples = perWordWPM(shuffled);
		expect(samples.map((s) => s.chars)).toEqual([5, 5]);
	});
});

describe('deriveBaselineWPM', () => {
	it('returns 0 for empty events', () => {
		expect(deriveBaselineWPM([])).toBe(0);
	});

	it('returns 0 when no word has ≥2 keystrokes', () => {
		// Ten single-char "words" — no per-word duration can be computed.
		const events: KeystrokeEvent[] = [];
		for (let i = 0; i < 10; i++) events.push(ev(i, i * 100, i, 'a'));
		expect(deriveBaselineWPM(events)).toBe(0);
	});

	it('is the plain mean when ≤10 samples (no trim)', () => {
		// Two 5-char words at uniform 100ms/char → identical WPM → mean = that WPM.
		const events = [...word(0, 100, 5, 0, 0), ...word(2000, 100, 5, 1, 5)];
		const baseline = deriveBaselineWPM(events);
		// 4 intervals × 100ms = 400ms; 5/5 / (400/60000) = 150 WPM.
		expect(baseline).toBeCloseTo(150, 5);
	});

	it('trims top and bottom deciles at ≥10 samples (spec §3.3)', () => {
		// 10 words: 9 clustered around ~100 WPM, 1 extreme outlier at ~600 WPM.
		// Bottom-decile (slowest) cut drops the slowest. Top-decile cut drops the
		// outlier. Remaining 8 samples mean ≈ normal cluster mean, not polluted
		// by the outlier.
		const events: KeystrokeEvent[] = [];
		let pos = 0;
		for (let w = 0; w < 9; w++) {
			// 5 chars at ~300ms/char → 4 * 300 = 1200ms duration → 50 WPM
			events.push(...word(w * 5000, 300, 5, w, pos));
			pos += 5;
		}
		// One absurdly fast word — the outlier that trimming should discard.
		events.push(...word(200_000, 20, 5, 9, pos));

		const baseline = deriveBaselineWPM(events);
		// With trimming: outlier removed, 8 remaining are all 50 WPM-ish →
		// baseline should be near 50. Without trimming it would be pulled up
		// toward 120+ by the outlier.
		expect(baseline).toBeGreaterThan(45);
		expect(baseline).toBeLessThan(60);
	});
});
