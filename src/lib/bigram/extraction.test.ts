import { describe, it, expect } from 'vitest';
import { extractBigramAggregates } from './extraction';
import type { KeystrokeEvent } from '../typing/types';

function ev(position: number, expected: string, actual: string, timestamp: number): KeystrokeEvent {
	return { position, expected, actual, timestamp, wordIndex: 0, positionInWord: position };
}

describe('extractBigramAggregates — shape', () => {
	it('returns empty when there are no events', () => {
		expect(extractBigramAggregates([], 's1')).toEqual([]);
	});

	it('returns empty with a single event (no pairs to form)', () => {
		expect(extractBigramAggregates([ev(0, 'a', 'a', 0)], 's1')).toEqual([]);
	});

	it('forms one aggregate from a two-event pair', () => {
		const result = extractBigramAggregates([ev(0, 't', 't', 100), ev(1, 'h', 'h', 200)], 's1');
		expect(result).toHaveLength(1);
		expect(result[0]).toMatchObject({
			bigram: 'th',
			sessionId: 's1',
			occurrences: 1,
			meanTime: 100,
			stdTime: 0,
			errorCount: 0,
			errorRate: 0
		});
	});

	it('sorts unordered input defensively by position', () => {
		// Capture emits in order but nothing prevents a future caller from shuffling.
		const result = extractBigramAggregates([ev(1, 'h', 'h', 200), ev(0, 't', 't', 100)], 's1');
		expect(result[0].bigram).toBe('th');
		expect(result[0].meanTime).toBe(100);
	});
});

describe('extractBigramAggregates — timing', () => {
	it('averages transition times across multiple clean occurrences of a bigram', () => {
		// "thth" typed cleanly, with th pairs spanning timestamps (100, 200) and (300, 400).
		const result = extractBigramAggregates(
			[
				ev(0, 't', 't', 100),
				ev(1, 'h', 'h', 200), // "th" Δ = 100
				ev(2, 't', 't', 300), // "ht" Δ = 100
				ev(3, 'h', 'h', 400) // "th" Δ = 100
			],
			's1'
		);
		const th = result.find((r) => r.bigram === 'th')!;
		expect(th.occurrences).toBe(2);
		expect(th.meanTime).toBe(100);
		expect(th.stdTime).toBe(0); // identical samples
	});

	it('excludes timing samples where either first input was wrong', () => {
		// "th" at (0,1): pos 0 wrong ('x'), pos 1 correct ('h') → NOT included in timing.
		// "th" at (2,3): both correct, Δ = 50ms → INCLUDED.
		const result = extractBigramAggregates(
			[ev(0, 't', 'x', 100), ev(1, 'h', 'h', 200), ev(2, 't', 't', 300), ev(3, 'h', 'h', 350)],
			's1'
		);
		const th = result.find((r) => r.bigram === 'th')!;
		expect(th.occurrences).toBe(2);
		expect(th.meanTime).toBe(50); // only the clean pair contributes
	});

	it('yields NaN meanTime when every occurrence had an error somewhere in the pair', () => {
		// All occurrences of "th" have at least one wrong first input.
		const result = extractBigramAggregates(
			[
				ev(0, 't', 'x', 100),
				ev(1, 'h', 'h', 200), // pos 0 wrong → excluded from timing
				ev(2, 't', 't', 300),
				ev(3, 'h', 'y', 400) // pos 3 wrong → excluded
			],
			's1'
		);
		const th = result.find((r) => r.bigram === 'th')!;
		expect(th.occurrences).toBe(2);
		expect(Number.isNaN(th.meanTime)).toBe(true);
		// With NaN meanTime, classification falls back to unclassified.
		expect(th.classification).toBe('unclassified');
	});

	it('computes a non-zero sample std when clean timings vary', () => {
		const result = extractBigramAggregates(
			[
				ev(0, 't', 't', 0),
				ev(1, 'h', 'h', 100),
				ev(2, 't', 't', 200),
				ev(3, 'h', 'h', 400) // Δ = 200
			],
			's1'
		);
		const th = result.find((r) => r.bigram === 'th')!;
		expect(th.meanTime).toBe(150);
		// sample std of [100, 200] with mean 150: sqrt(sum((x-μ)²)/(n-1)) = sqrt(5000) ≈ 70.71
		expect(th.stdTime).toBeCloseTo(70.71, 2);
	});
});

describe('extractBigramAggregates — errors', () => {
	it('attributes errors to the right-hand char of the bigram', () => {
		// "th" with right char wrong should count as 1 error for "th".
		// Left-char error (e.g. pos 0 wrong) doesn't count for "th" — it would count
		// for the *previous* bigram's right char (which doesn't exist here).
		const result = extractBigramAggregates(
			[
				ev(0, 't', 't', 0),
				ev(1, 'h', 'x', 100), // right wrong → error for "th"
				ev(2, 'e', 'e', 200) // "he" right correct → no error for "he"
			],
			's1'
		);
		const th = result.find((r) => r.bigram === 'th')!;
		const he = result.find((r) => r.bigram === 'he')!;
		expect(th.errorCount).toBe(1);
		expect(th.errorRate).toBe(1);
		expect(he.errorCount).toBe(0);
	});

	it('does not double-count a wrong char across the two bigrams it spans', () => {
		// Pos 1 is wrong. It's the right-char of "th" (counts) and the left-char of
		// "he" (does not count). So "th" gets one error, "he" gets none.
		const result = extractBigramAggregates(
			[ev(0, 't', 't', 0), ev(1, 'h', 'x', 100), ev(2, 'e', 'e', 200)],
			's1'
		);
		expect(result.find((r) => r.bigram === 'th')!.errorCount).toBe(1);
		expect(result.find((r) => r.bigram === 'he')!.errorCount).toBe(0);
	});
});

describe('extractBigramAggregates — boundaries', () => {
	it('treats space as a regular char (word-boundary bigrams)', () => {
		// "ab cd" yields bigrams: "ab", "b ", " c", "cd" (space counts both ways).
		const result = extractBigramAggregates(
			[
				ev(0, 'a', 'a', 0),
				ev(1, 'b', 'b', 100),
				ev(2, ' ', ' ', 200),
				ev(3, 'c', 'c', 300),
				ev(4, 'd', 'd', 400)
			],
			's1'
		);
		const keys = result.map((r) => r.bigram).sort();
		expect(keys).toEqual([' c', 'ab', 'b ', 'cd']);
	});

	it('skips non-consecutive positions rather than forming a spurious bigram', () => {
		// Gap between pos 1 and pos 5 (e.g. aborted session) — no "h?" bigram formed.
		const result = extractBigramAggregates(
			[ev(0, 't', 't', 0), ev(1, 'h', 'h', 100), ev(5, 'z', 'z', 500)],
			's1'
		);
		expect(result.map((r) => r.bigram)).toEqual(['th']);
	});
});

describe('extractBigramAggregates — samples', () => {
	it('emits one sample per occurrence, in observation order', () => {
		// "thth" — two "th" occurrences, both clean; timings 100 and 100.
		const result = extractBigramAggregates(
			[ev(0, 't', 't', 0), ev(1, 'h', 'h', 100), ev(2, 't', 't', 200), ev(3, 'h', 'h', 300)],
			's1'
		);
		const th = result.find((r) => r.bigram === 'th')!;
		expect(th.samples).toEqual([
			{ correct: true, timing: 100 },
			{ correct: true, timing: 100 }
		]);
	});

	it('sample.timing is null whenever either side of the pair was wrong', () => {
		// First "th": pos 0 wrong → timing null, but right was correct so correct=true.
		// Second "th": pos 3 wrong → right wrong so correct=false, timing null.
		const result = extractBigramAggregates(
			[ev(0, 't', 'x', 100), ev(1, 'h', 'h', 200), ev(2, 't', 't', 300), ev(3, 'h', 'y', 400)],
			's1'
		);
		const th = result.find((r) => r.bigram === 'th')!;
		expect(th.samples).toEqual([
			{ correct: true, timing: null },
			{ correct: false, timing: null }
		]);
	});

	it('samples length equals occurrences, and errorCount matches correct=false count', () => {
		const result = extractBigramAggregates(
			[ev(0, 'a', 'a', 0), ev(1, 'b', 'x', 100), ev(2, 'a', 'a', 200), ev(3, 'b', 'b', 300)],
			's1'
		);
		const ab = result.find((r) => r.bigram === 'ab')!;
		expect(ab.samples!).toHaveLength(ab.occurrences);
		expect(ab.samples!.filter((s) => !s.correct).length).toBe(ab.errorCount);
	});
});

describe('extractBigramAggregates — invariants', () => {
	it('preserves total pair count across all aggregates', () => {
		// Property: sum(occurrences) === number of consecutive adjacent pairs in input.
		const events: KeystrokeEvent[] = [];
		const text = 'the quick brown fox';
		for (let i = 0; i < text.length; i++) {
			events.push(ev(i, text[i], text[i], i * 100));
		}
		const result = extractBigramAggregates(events, 's1');
		const totalOccurrences = result.reduce((acc, r) => acc + r.occurrences, 0);
		expect(totalOccurrences).toBe(text.length - 1);
	});

	it('every bigram appears at most once in the output (deduplicated by key)', () => {
		const events: KeystrokeEvent[] = [];
		// "ababab" should yield bigrams "ab" (3×) and "ba" (2×), each as one row.
		const text = 'ababab';
		for (let i = 0; i < text.length; i++) {
			events.push(ev(i, text[i], text[i], i * 100));
		}
		const result = extractBigramAggregates(events, 's1');
		const keys = result.map((r) => r.bigram);
		expect(new Set(keys).size).toBe(keys.length);
		expect(result.find((r) => r.bigram === 'ab')!.occurrences).toBe(3);
		expect(result.find((r) => r.bigram === 'ba')!.occurrences).toBe(2);
	});
});
