import { describe, expect, it } from 'vitest';
import {
	checkBigramGraduation,
	DEFAULT_MIN_SAMPLE_SIZE,
	phaseTargetMsFromWPM,
	type BigramOccurrence
} from './graduation';

/**
 * Helper: build a run of `n` occurrences, all correct, all at exactly
 * the given transition time. Tests override parts of the tail for
 * boundary cases.
 */
function run(n: number, transitionMs: number, correct = true): BigramOccurrence[] {
	return Array.from({ length: n }, () => ({ correct, transitionMs }));
}

describe('phaseTargetMsFromWPM', () => {
	// 60 words × 5 chars / min → 200 ms/char at 60 WPM; scales linearly.
	// Non-positive WPM → +Infinity (defensive, so downstream never NaN-s).
	it.each`
		wpm    | expected
		${60}  | ${200}
		${100} | ${120}
		${0}   | ${Number.POSITIVE_INFINITY}
		${-10} | ${Number.POSITIVE_INFINITY}
	`(
		'$wpm WPM → $expected ms/transition',
		({ wpm, expected }: { wpm: number; expected: number }) => {
			expect(phaseTargetMsFromWPM(wpm)).toBe(expected);
		}
	);
});

describe('checkBigramGraduation', () => {
	it('insufficient-data when fewer than 15 occurrences', () => {
		const r = checkBigramGraduation({
			recent: run(14, 200),
			phaseTargetMs: 200
		});
		expect(r.graduated).toBe(false);
		expect(r.reason).toBe('insufficient-data');
		expect(r.details.sampleSize).toBe(14);
	});

	/**
	 * Accuracy-boundary sweep. Each row starts with `run(15, 200)` and flips
	 * the first `wrongCount` samples to `correct: false`. Targets the
	 * 14/15 spec boundary: one wrong is fine, two is not.
	 */
	it.each`
		description                | wrongCount | graduated | reason
		${'15/15 correct'}         | ${0}       | ${true}   | ${'graduated'}
		${'14/15 (1 wrong start)'} | ${1}       | ${true}   | ${'graduated'}
		${'13/15 (2 wrong start)'} | ${2}       | ${false}  | ${'accuracy-low'}
	`(
		'accuracy: $description → $reason',
		({
			wrongCount,
			graduated,
			reason
		}: {
			wrongCount: number;
			graduated: boolean;
			reason: string;
		}) => {
			const recent = run(15, 200);
			for (let i = 0; i < wrongCount; i++) {
				recent[i] = { correct: false, transitionMs: 200 };
			}
			const r = checkBigramGraduation({ recent, phaseTargetMs: 200 });
			expect(r.graduated).toBe(graduated);
			expect(r.reason).toBe(reason);
		}
	);

	it('places the inaccurate sample at the tail — still graduates if ≥14/15', () => {
		// Accuracy is counted across the full sample regardless of position.
		// A wrong-correctness flag doesn't affect the speed check (which only
		// looks at transitionMs), so a single tail-wrong still graduates.
		const recent = run(15, 200);
		recent[14] = { correct: false, transitionMs: 200 };
		const r = checkBigramGraduation({ recent, phaseTargetMs: 200 });
		expect(r.graduated).toBe(true);
	});

	/**
	 * Speed-boundary sweep. Each row overrides sample 14's transitionMs
	 * against a 200ms target with default 20% tolerance (cap 240ms).
	 * One-sided: faster than target always passes; only slow-beyond-cap fails.
	 */
	it.each`
		description             | lastMs | graduated | reason
		${'exactly target'}     | ${200} | ${true}   | ${'graduated'}
		${'-50% (much faster)'} | ${100} | ${true}   | ${'graduated'}
		${'-20%'}               | ${160} | ${true}   | ${'graduated'}
		${'+20% (boundary)'}    | ${240} | ${true}   | ${'graduated'}
		${'+30% (too slow)'}    | ${260} | ${false}  | ${'speed-off'}
	`(
		'speed: tail @ $description ms → $reason',
		({ lastMs, graduated, reason }: { lastMs: number; graduated: boolean; reason: string }) => {
			const recent = run(15, 200);
			recent[14] = { correct: true, transitionMs: lastMs };
			const r = checkBigramGraduation({ recent, phaseTargetMs: 200 });
			expect(r.graduated).toBe(graduated);
			expect(r.reason).toBe(reason);
		}
	);

	it('only the last `speedWindow` transitions are checked for speed', () => {
		// Default window = 5. Samples 0–9 are ridiculously slow; the last 5
		// are at target. Graduation should succeed — earlier transitions
		// don't count for the speed check.
		const recent = [...run(10, 10_000), ...run(5, 200)];
		const r = checkBigramGraduation({ recent, phaseTargetMs: 200 });
		expect(r.graduated).toBe(true);
	});

	it('only the last `minSampleSize` are checked for accuracy', () => {
		// 20 occurrences; the first 5 are wrong but outside the window.
		// Last 15 all correct → should pass.
		const recent = [...run(5, 200, false), ...run(15, 200, true)];
		const r = checkBigramGraduation({ recent, phaseTargetMs: 200 });
		expect(r.graduated).toBe(true);
		expect(r.details.sampleSize).toBe(DEFAULT_MIN_SAMPLE_SIZE);
	});

	it('overrides let callers tune thresholds (e.g. stricter drill)', () => {
		// Stricter: 20-sample window, 19/20 accuracy minimum, 10-sample
		// speed window, 10% tolerance. 20 perfect samples should still pass.
		const r = checkBigramGraduation({
			recent: run(20, 200),
			phaseTargetMs: 200,
			minSampleSize: 20,
			minAccuracyCorrect: 19,
			speedWindow: 10,
			speedToleranceRatio: 0.1
		});
		expect(r.graduated).toBe(true);
		expect(r.details.sampleSize).toBe(20);
		expect(r.details.speedWindowSize).toBe(10);
	});

	it('non-positive phaseTargetMs → speed check fails silently (never graduates)', () => {
		// Defensive: callers who forget to compute phaseTargetMs correctly
		// get a no-graduation result rather than an exception. Accuracy
		// details still populated.
		const r = checkBigramGraduation({ recent: run(15, 200), phaseTargetMs: 0 });
		expect(r.graduated).toBe(false);
		expect(r.reason).toBe('speed-off');
		expect(r.details.speedWithinTolerance).toBe(0);
	});
});
