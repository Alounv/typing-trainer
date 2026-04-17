import { describe, it, expect } from 'vitest';
import { annotateFirstInputs } from './postprocess';
import type { KeystrokeEvent } from './types';

function ev(position: number, expected: string, actual: string, timestamp: number): KeystrokeEvent {
	return { position, expected, actual, timestamp, wordIndex: 0, positionInWord: position };
}

describe('annotateFirstInputs', () => {
	it('returns empty for empty input', () => {
		expect(annotateFirstInputs([])).toEqual([]);
	});

	it('leaves a single correct keystroke untouched', () => {
		const result = annotateFirstInputs([ev(0, 'a', 'a', 100)]);
		expect(result).toEqual([{ ...ev(0, 'a', 'a', 100), corrected: false, correctionDelay: 0 }]);
	});

	it('keeps an uncorrected wrong keystroke marked uncorrected', () => {
		const result = annotateFirstInputs([ev(0, 'a', 'x', 100)]);
		expect(result[0]).toMatchObject({ corrected: false, correctionDelay: 0 });
	});

	it('marks a wrong-then-correct retype as corrected with the right delay', () => {
		const result = annotateFirstInputs([
			ev(0, 't', 't', 100),
			ev(1, 'h', 'e', 200), // wrong
			ev(1, 'h', 'h', 500), // correction
			ev(2, 'e', 'e', 600)
		]);

		// One event per position — the first input is the one that survives.
		expect(result.map((e) => [e.position, e.actual])).toEqual([
			[0, 't'],
			[1, 'e'], // original wrong input, annotated
			[2, 'e']
		]);

		const pos1 = result[1];
		expect(pos1.corrected).toBe(true);
		expect(pos1.correctionDelay).toBe(300);
	});

	it('takes the earliest correct retype when there are multiple retypes', () => {
		const result = annotateFirstInputs([
			ev(0, 'a', 'x', 100), // wrong
			ev(0, 'a', 'y', 200), // wrong retype
			ev(0, 'a', 'a', 400), // first correct retype
			ev(0, 'a', 'a', 600) // later correct retype — ignored
		]);

		expect(result).toHaveLength(1);
		expect(result[0]).toMatchObject({ corrected: true, correctionDelay: 300 });
	});

	it('leaves corrected=false when none of the retypes matched expected', () => {
		const result = annotateFirstInputs([
			ev(0, 'a', 'x', 100),
			ev(0, 'a', 'y', 200),
			ev(0, 'a', 'z', 300)
		]);
		expect(result[0]).toMatchObject({ corrected: false, correctionDelay: 0 });
	});

	it('sorts retypes by timestamp before picking the first', () => {
		// Deliberately unordered input — capture emits in order, but downstream
		// callers might mutate, so the function defends itself.
		const result = annotateFirstInputs([
			ev(0, 'a', 'a', 500), // arrives first in array but is chronologically 2nd
			ev(0, 'a', 'x', 100) // chronologically 1st — the real first input
		]);

		expect(result[0].actual).toBe('x'); // the true first input
		expect(result[0].corrected).toBe(true);
		expect(result[0].correctionDelay).toBe(400);
	});

	it('returns annotated events sorted by position', () => {
		const result = annotateFirstInputs([
			ev(2, 'c', 'c', 300),
			ev(0, 'a', 'a', 100),
			ev(1, 'b', 'b', 200)
		]);
		expect(result.map((e) => e.position)).toEqual([0, 1, 2]);
	});
});
