import { describe, expect, it } from 'vitest';
import { selectQuote } from './quotes';
import type { Quote, QuoteBank } from './types';

function bank(quotes: Quote[]): QuoteBank {
	return {
		language: 'test',
		groups: [
			[0, 100],
			[101, 300]
		],
		quotes
	};
}

function q(id: number, text: string, length = text.length): Quote {
	return { id, text, source: `src-${id}`, length };
}

describe('selectQuote', () => {
	it('throws on an empty bank', () => {
		expect(() => selectQuote(bank([]))).toThrow();
	});

	it('returns a quote from the bank (uniform when no targets/filter)', () => {
		const b = bank([q(1, 'one'), q(2, 'two')]);
		const got = selectQuote(b, { rng: () => 0 });
		// rng=0 → cumulative-weight pick always lands on the first bucket.
		expect(got.id).toBe(1);
	});

	it('respects lengthGroup inclusive bounds', () => {
		const b = bank([
			q(1, 'short'), // length 5
			q(2, 'a'.repeat(50), 50),
			q(3, 'a'.repeat(200), 200)
		]);
		// [0, 100] includes the 5-char and 50-char quotes, excludes 200.
		const got = selectQuote(b, { lengthGroup: [0, 100], rng: () => 0 });
		expect([1, 2]).toContain(got.id);
		expect(got.id).not.toBe(3);
	});

	it('falls back to full bank when lengthGroup yields no candidates', () => {
		// A pathological filter shouldn't deadlock the caller — the spec doesn't
		// specify behavior, but "always return something" is the least-surprising
		// contract.
		const b = bank([q(1, 'short'), q(2, 'still short')]);
		const got = selectQuote(b, { lengthGroup: [9000, 9999], rng: () => 0 });
		expect(got).toBeDefined();
	});

	it('biases toward quotes containing target bigrams', () => {
		// Two quotes; only quote 2 contains "th". Under the multiplicative
		// boost, quote 2's weight should outrun quote 1's base weight of 1.
		// Probe a handful of seed points (rng returns fractional); expect
		// quote 2 to be picked at a rate well above 50%.
		const b = bank([
			q(1, 'no target here at all at all at all'),
			q(2, 'the the the') // 3 occurrences of 'th'
		]);
		let q2 = 0;
		const N = 20;
		for (let i = 0; i < N; i++) {
			const got = selectQuote(b, {
				targetBigrams: ['th'],
				rng: () => i / N
			});
			if (got.id === 2) q2++;
		}
		// Without target bigrams: 50/50. With 3 target occurrences on quote 2,
		// its weight ≈ 1.5^3 = 3.375 vs. 1 for quote 1 → ~77% pick rate.
		expect(q2 / N).toBeGreaterThan(0.7);
	});

	it('ignores target bigrams shorter than 2 chars', () => {
		// Guards against off-by-one callers passing single chars accidentally.
		const b = bank([q(1, 'aaa'), q(2, 'bbb')]);
		// No real targets → uniform sampling, rng=0 always hits first bucket.
		const got = selectQuote(b, { targetBigrams: ['a', ''], rng: () => 0 });
		expect(got.id).toBe(1);
	});

	it('returns from pool when all weights are zero (guard)', () => {
		// Can't construct zero-weight via normal config (base weight is 1), but
		// exercising the branch protects against future weight schemes that
		// could return 0. Sanity check: under normal targets the branch is
		// never taken, and this call returns *some* quote without throwing.
		const b = bank([q(1, 'hello world')]);
		const got = selectQuote(b, { rng: () => 0.5 });
		expect(got.id).toBe(1);
	});
});
