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
	it('maps 60 WPM → 200 ms per transition', () => {
		// 60 words × 5 chars = 300 chars/min = 200 ms/char.
		expect(phaseTargetMsFromWPM(60)).toBe(200);
	});

	it('maps 100 WPM → 120 ms per transition', () => {
		expect(phaseTargetMsFromWPM(100)).toBe(120);
	});

	it('returns +Infinity for non-positive WPM (defensive, never crash)', () => {
		expect(phaseTargetMsFromWPM(0)).toBe(Number.POSITIVE_INFINITY);
		expect(phaseTargetMsFromWPM(-10)).toBe(Number.POSITIVE_INFINITY);
	});
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

	it('graduates on 15 correct in a row at exactly target speed', () => {
		// All 15 correct (14/15 threshold met), all 5 speed-window samples
		// exactly at target → within tolerance.
		const r = checkBigramGraduation({
			recent: run(15, 200),
			phaseTargetMs: 200
		});
		expect(r.graduated).toBe(true);
		expect(r.reason).toBe('graduated');
		expect(r.details.accuracyCorrect).toBe(15);
		expect(r.details.speedWithinTolerance).toBe(5);
	});

	it('accepts exactly 14/15 correct (spec boundary)', () => {
		const recent = run(15, 200);
		recent[0] = { correct: false, transitionMs: 200 };
		const r = checkBigramGraduation({ recent, phaseTargetMs: 200 });
		expect(r.graduated).toBe(true);
	});

	it('rejects 13/15 correct with accuracy-low', () => {
		const recent = run(15, 200);
		recent[0] = { correct: false, transitionMs: 200 };
		recent[1] = { correct: false, transitionMs: 200 };
		const r = checkBigramGraduation({ recent, phaseTargetMs: 200 });
		expect(r.graduated).toBe(false);
		expect(r.reason).toBe('accuracy-low');
		expect(r.details.accuracyCorrect).toBe(13);
	});

	it('places the inaccurate samples at the tail — still graduates if ≥14/15', () => {
		// Even if the one wrong-answer is *in* the speed window, graduation
		// counts accuracy across the full 15 — so 14/15 passes, and speed
		// tolerance is judged on transition time (which we keep at target).
		// (Reason this test matters: the "correct" and "speed within
		// tolerance" checks are independent.)
		const recent = run(15, 200);
		recent[14] = { correct: false, transitionMs: 200 };
		const r = checkBigramGraduation({ recent, phaseTargetMs: 200 });
		expect(r.graduated).toBe(true);
	});

	it('accepts a tail sample faster than target — one-sided tolerance', () => {
		// Default tolerance 20% → cap at 240 ms. No floor — any speed
		// faster than target is fine. 100 ms is way faster → still passes.
		const recent = run(15, 200);
		recent[14] = { correct: true, transitionMs: 100 };
		const r = checkBigramGraduation({ recent, phaseTargetMs: 200 });
		expect(r.graduated).toBe(true);
		expect(r.details.speedWithinTolerance).toBe(5);
	});

	it('rejects speed-off when a tail sample is slower than tolerance', () => {
		const recent = run(15, 200);
		recent[14] = { correct: true, transitionMs: 260 };
		const r = checkBigramGraduation({ recent, phaseTargetMs: 200 });
		expect(r.graduated).toBe(false);
		expect(r.reason).toBe('speed-off');
	});

	it('boundary: exactly +20% is within tolerance (inclusive ≤)', () => {
		// Target 200 ms, 20% tol → cap 240 ms. Exactly-240 transitions pass.
		const recent = run(15, 200);
		recent[14] = { correct: true, transitionMs: 240 };
		const r = checkBigramGraduation({ recent, phaseTargetMs: 200 });
		expect(r.graduated).toBe(true);
	});

	it('boundary: any speed faster than target passes under one-sided tolerance', () => {
		// -20% (160 ms) or even -50% (100 ms) — both fine, only too-slow
		// trips the check.
		const at160 = run(15, 200);
		at160[14] = { correct: true, transitionMs: 160 };
		expect(checkBigramGraduation({ recent: at160, phaseTargetMs: 200 }).graduated).toBe(true);

		const at100 = run(15, 200);
		at100[14] = { correct: true, transitionMs: 100 };
		expect(checkBigramGraduation({ recent: at100, phaseTargetMs: 200 }).graduated).toBe(true);
	});

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
