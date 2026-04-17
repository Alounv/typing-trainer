import { describe, expect, it } from 'vitest';
import { computeRoundBoundaries } from './rounds';

describe('computeRoundBoundaries', () => {
	it('single round returns empty — no mid-session beats', () => {
		expect(computeRoundBoundaries([10, 10, 10], 1, 1)).toEqual([]);
	});

	it('splits evenly divisible chunks into equal rounds', () => {
		// 4 chunks × 10 chars + 3 separators × 1 char = 43 chars total.
		// Round 1 ends after chunk 0 (offset 10), round 2 after chunk 1
		// (offset 21), round 3 after chunk 2 (offset 32). Final round
		// ends at text end (implicit — not in boundaries).
		expect(computeRoundBoundaries([10, 10, 10, 10], 1, 4)).toEqual([10, 21, 32]);
	});

	it('rounds up when chunks do not divide evenly — last round takes the remainder', () => {
		// 5 chunks / 4 rounds → boundaries at chunks 1, 2, 3 (indices
		// ceil(r × 5 / 4) - 1 for r=1..3). Final round has chunks 4 only.
		const out = computeRoundBoundaries([10, 10, 10, 10, 10], 1, 4);
		// Offsets: after chunk 1 = 21, after chunk 2 = 32, after chunk 3 = 43.
		expect(out).toEqual([21, 32, 43]);
	});

	it('honors separator length', () => {
		// 2-char separator (matches real-text QUOTE_SEPARATOR).
		expect(computeRoundBoundaries([10, 10], 2, 2)).toEqual([10]);
	});

	it('returns empty for zero chunks', () => {
		expect(computeRoundBoundaries([], 1, 4)).toEqual([]);
	});
});
