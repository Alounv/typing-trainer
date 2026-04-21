import { describe, expect, it } from 'vitest';
import { SPEED_PACE_MULTIPLIER, computeGhostPosition, paceForMode } from './pacer';

describe('paceForMode', () => {
	it('applies the speed multiplier for speed mode', () => {
		expect(paceForMode('speed', 60)).toBeCloseTo(60 * SPEED_PACE_MULTIPLIER, 5);
	});

	it('returns 0 for accuracy mode — pacer is hidden in accuracy drills', () => {
		expect(paceForMode('accuracy', 60)).toBe(0);
	});

	it('returns 0 when baselineWPM is 0 (no diagnostic yet)', () => {
		// Drill route skips ghost rendering entirely in this case — matches the
		// "no diagnostic on file" UX where the pacer doesn't know a target.
		expect(paceForMode('speed', 0)).toBe(0);
	});

	it('returns 0 for negative baselineWPM (defensive — should never happen)', () => {
		expect(paceForMode('speed', -5)).toBe(0);
	});
});

describe('computeGhostPosition', () => {
	it('advances at exactly WPM × 5 chars per minute', () => {
		// 60 WPM = 300 chars/min = 5 chars/sec → 5 chars after 1000 ms.
		expect(computeGhostPosition(1000, 60)).toBe(5);
	});

	it('is zero at t=0', () => {
		expect(computeGhostPosition(0, 60)).toBe(0);
	});

	it('floors to an integer index', () => {
		// 60 WPM, 500 ms → 2.5 chars → floor = 2. We render a single-char ghost,
		// so fractional indices aren't meaningful.
		expect(computeGhostPosition(500, 60)).toBe(2);
	});

	it('scales linearly with paceWPM', () => {
		// 120 WPM = 2× chars/sec compared to 60 WPM.
		expect(computeGhostPosition(1000, 120)).toBe(10);
	});

	it('returns 0 when elapsedMs is negative (defensive)', () => {
		expect(computeGhostPosition(-100, 60)).toBe(0);
	});

	it('returns 0 when paceWPM is 0 — pacer is effectively disabled', () => {
		expect(computeGhostPosition(5000, 0)).toBe(0);
	});
});
