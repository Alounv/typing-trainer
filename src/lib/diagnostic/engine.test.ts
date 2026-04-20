import { describe, expect, it } from 'vitest';
import { generateDiagnosticReport } from './engine';
import type { KeystrokeEvent } from '../typing/types';

/** 5-char word ranging timestamp [start, start + 4*dt] at wordIndex w. */
function wordEvents(start: number, dt: number, w: number, basePos: number): KeystrokeEvent[] {
	return Array.from({ length: 5 }, (_, i) => ({
		position: basePos + i,
		timestamp: start + i * dt,
		expected: 'a',
		actual: 'a',
		wordIndex: w,
		positionInWord: i
	}));
}

describe('generateDiagnosticReport', () => {
	it('derives baselineWPM from the keystroke events', () => {
		const events = [...wordEvents(0, 200, 0, 0), ...wordEvents(2000, 200, 1, 5)];
		const expectedBaseline = 10 / 5 / (2800 / 60_000);
		const r = generateDiagnosticReport({ events });
		expect(r.baselineWPM).toBeCloseTo(expectedBaseline, 5);
	});
});
