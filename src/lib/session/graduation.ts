/**
 * In-session graduation check. A bigram graduates when: (1) ≥14/15 accurate in
 * recent occurrences, and (2) the last 5 transitions are all within 1.2× the
 * phase target time. Pure — runner feeds ordered occurrences.
 *
 * One-sided tolerance: faster than target is always a win. For acquisition/hasty
 * the phase target is a deliberately-slow floor (60% baseline) and for fluency
 * it's already fast, so a symmetric bound would punish outperformance.
 */

/** Defaults exported for doc + test clarity. */
export const DEFAULT_MIN_SAMPLE_SIZE = 15;
export const DEFAULT_MIN_ACCURACY_CORRECT = 14;
export const DEFAULT_SPEED_WINDOW = 5;
export const DEFAULT_SPEED_TOLERANCE = 0.2;

/** One occurrence = user typed the right-hand char after the left-hand char. */
export interface BigramOccurrence {
	/** Right-hand char matched `expected` (first-input sticks). */
	correct: boolean;
	/** Elapsed ms from left-keystroke to right-keystroke for this occurrence. */
	transitionMs: number;
}

export interface GraduationInput {
	/** Chronological (oldest-first). Only the last `minSampleSize` are examined. */
	recent: readonly BigramOccurrence[];
	/** Ms per bigram transition. Use {@link phaseTargetMsFromWPM} to compute. */
	phaseTargetMs: number;
	/** Override sample size (default 15). */
	minSampleSize?: number;
	/** Override accuracy bar (default 14). */
	minAccuracyCorrect?: number;
	/** Override speed-window size (default 5). */
	speedWindow?: number;
	/** Override speed tolerance ratio (default 0.2). */
	speedToleranceRatio?: number;
}

export type GraduationReason = 'graduated' | 'insufficient-data' | 'accuracy-low' | 'speed-off';

export interface GraduationResult {
	graduated: boolean;
	reason: GraduationReason;
	details: {
		/** Size of the tail actually evaluated. Capped at `minSampleSize`. */
		sampleSize: number;
		/** Correct count within `sampleSize`. */
		accuracyCorrect: number;
		accuracyThreshold: number;
		/** Count of the last `speedWindow` transitions within tolerance. */
		speedWithinTolerance: number;
		speedWindowSize: number;
	};
}

/**
 * Phase target WPM → ms per bigram transition. `60_000 / (5×wpm) = 12_000/wpm`.
 * Returns +Infinity for wpm ≤ 0 so tolerance checks fail loudly instead of divide-by-zero.
 */
export function phaseTargetMsFromWPM(wpm: number): number {
	if (wpm <= 0) return Number.POSITIVE_INFINITY;
	return 12_000 / wpm;
}

/** Check whether a bigram has met graduation criteria. */
export function checkBigramGraduation(input: GraduationInput): GraduationResult {
	const minSample = input.minSampleSize ?? DEFAULT_MIN_SAMPLE_SIZE;
	const minCorrect = input.minAccuracyCorrect ?? DEFAULT_MIN_ACCURACY_CORRECT;
	const speedWindow = input.speedWindow ?? DEFAULT_SPEED_WINDOW;
	const tol = input.speedToleranceRatio ?? DEFAULT_SPEED_TOLERANCE;

	const sample = input.recent.slice(-minSample);
	const sampleSize = sample.length;

	// Accuracy over the full sample; speed over the tail. Both counts land in
	// `details` so UI can show "12/15 correct, 3/5 within pace" even on fail.
	let correct = 0;
	for (const o of sample) if (o.correct) correct++;

	const speedTail = sample.slice(-speedWindow);
	let within = 0;
	for (const o of speedTail) {
		// One-sided: pass iff transitionMs ≤ target × (1 + tol). No upper bound
		// on speed. Zero/Infinity target skips; `within` stays 0 → speed-off.
		if (input.phaseTargetMs > 0 && Number.isFinite(input.phaseTargetMs)) {
			if (o.transitionMs <= input.phaseTargetMs * (1 + tol)) within++;
		}
	}

	const details: GraduationResult['details'] = {
		sampleSize,
		accuracyCorrect: correct,
		accuracyThreshold: minCorrect,
		speedWithinTolerance: within,
		speedWindowSize: speedTail.length
	};

	if (sampleSize < minSample) {
		return { graduated: false, reason: 'insufficient-data', details };
	}
	if (correct < minCorrect) {
		return { graduated: false, reason: 'accuracy-low', details };
	}
	// Every sample in the speed window must be within tolerance — all, not a majority.
	if (within < speedTail.length) {
		return { graduated: false, reason: 'speed-off', details };
	}
	return { graduated: true, reason: 'graduated', details };
}
