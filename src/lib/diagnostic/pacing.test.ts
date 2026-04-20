import { describe, expect, it } from 'vitest';
import { computeTargetWPM, deriveBaselineWPM, TARGET_WPM_MULTIPLIER } from './pacing';
import type { KeystrokeEvent } from '../typing/types';

function ev(position: number, timestamp: number, wordIndex: number, expected = 'a'): KeystrokeEvent {
	return {
		position,
		timestamp,
		expected,
		actual: expected,
		wordIndex,
		positionInWord: position
	};
}

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
	it('multiplies baseline by the target-WPM constant', () => {
		expect(computeTargetWPM(60)).toBeCloseTo(60 * TARGET_WPM_MULTIPLIER, 5);
	});

	it('returns 0 when baseline is 0', () => {
		expect(computeTargetWPM(0)).toBe(0);
	});
});

describe('deriveBaselineWPM', () => {
	it('returns 0 for empty events', () => {
		expect(deriveBaselineWPM([])).toBe(0);
	});

	it('returns 0 for a single event', () => {
		expect(deriveBaselineWPM([ev(0, 1000, 0, 'a')])).toBe(0);
	});

	it('returns 0 when all events share a timestamp', () => {
		const events = [ev(0, 1000, 0, 'a'), ev(1, 1000, 0, 'a')];
		expect(deriveBaselineWPM(events)).toBe(0);
	});

	it('is wall-clock over the full event span', () => {
		const events = word(0, 200, 5, 0, 0);
		expect(deriveBaselineWPM(events)).toBeCloseTo(75, 5);
	});

	it('includes inter-word pauses', () => {
		const events = [...word(0, 100, 5, 0, 0), ...word(2400, 100, 5, 1, 5)];
		expect(deriveBaselineWPM(events)).toBeCloseTo(10 / 5 / (2800 / 60_000), 5);
	});

	it('counts unique positions — retypes do not inflate the char count', () => {
		const events = [...word(0, 100, 5, 0, 0), ev(2, 500, 0, 'a')];
		expect(deriveBaselineWPM(events)).toBeCloseTo(120, 5);
	});

	it('is stable under shuffled input', () => {
		const a = word(0, 100, 5, 0, 0);
		const b = word(2000, 100, 5, 1, 5);
		const ordered = deriveBaselineWPM([...a, ...b]);
		const shuffled = deriveBaselineWPM([...b, ...a]);
		expect(shuffled).toBeCloseTo(ordered, 10);
	});
});
