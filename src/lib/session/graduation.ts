/**
 * In-session graduation check (spec §4.1).
 *
 * A bigram "graduates" out of the current drill when, over its most
 * recent occurrences, both conditions hold:
 *
 *   1. Accuracy: ≥ {@link DEFAULT_MIN_ACCURACY_CORRECT} correct out of the
 *      last {@link DEFAULT_MIN_SAMPLE_SIZE} occurrences (14/15 by default).
 *   2. Speed consistency: every one of the last {@link DEFAULT_SPEED_WINDOW}
 *      transitions is at most {@link DEFAULT_SPEED_TOLERANCE} slower than
 *      the phase target time. Faster than target is always fine.
 *
 * The module is pure. The session runner feeds an ordered list of recent
 * occurrences per bigram; graduation.ts doesn't track timers or events.
 *
 * ### On one-sided tolerance
 *
 * Spec §4.1 wording: "last 5 are within 20% of phase speed target". We
 * read this as "no slower than 1.2× target" — a max-slowness bound, not
 * symmetric. Rationale: for `acquisition`/`hasty` bigrams the phase
 * target is the deliberately-slow floor (60% of baseline WPM) with "no
 * speed pressure" (spec §4.1), so typing faster is improvement, not a
 * violation. For `fluency` bigrams the target is already fast; faster
 * still is the win condition. Symmetric tolerance would punish the user
 * for outperforming the target, which isn't the drill's intent.
 */

/** Spec §4.1 defaults — exported for doc + test clarity. */
export const DEFAULT_MIN_SAMPLE_SIZE = 15;
export const DEFAULT_MIN_ACCURACY_CORRECT = 14;
export const DEFAULT_SPEED_WINDOW = 5;
export const DEFAULT_SPEED_TOLERANCE = 0.2;

/**
 * Atomic observation the runner feeds to the graduation check.
 * One occurrence = one user typing the right-hand char of a drill bigram
 * after the left-hand char.
 */
export interface BigramOccurrence {
	/** Right-hand char matched `expected` (first-input sticks). */
	correct: boolean;
	/** Elapsed ms from left-keystroke to right-keystroke for this occurrence. */
	transitionMs: number;
}

export interface GraduationInput {
	/**
	 * Per-bigram occurrence stream, chronologically ordered (oldest first,
	 * newest last). Only the tail of length {@link GraduationInput.minSampleSize}
	 * is examined — earlier entries are history and ignored.
	 */
	recent: readonly BigramOccurrence[];
	/**
	 * Phase speed target expressed as ms per bigram transition. For
	 * acquisition/hasty this is `12_000 / (0.6 × baselineWPM)`; for fluency
	 * it's `12_000 / targetWPM`. Callers use {@link phaseTargetMsFromWPM}.
	 */
	phaseTargetMs: number;
	/** Override the sample size (spec default 15). */
	minSampleSize?: number;
	/** Override the accuracy bar out of `minSampleSize` (spec default 14). */
	minAccuracyCorrect?: number;
	/** Override the speed-window size (spec default 5). */
	speedWindow?: number;
	/** Override the symmetric speed tolerance ratio (spec default 0.2). */
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
 * Convert a phase target WPM into ms per bigram transition.
 *
 * 1 word = 5 chars; at `wpm` words per minute the user types `5×wpm`
 * chars per 60 s → `60_000 / (5×wpm) = 12_000 / wpm` ms per char.
 * A bigram transition is a char-to-char interval, so that same ms value
 * is the target transition time.
 *
 * Guards: returns +Infinity for `wpm ≤ 0` — the caller shouldn't pass
 * non-positive WPM, but silently crashing on divide-by-zero is worse
 * than an infinite ms target (which then fails every tolerance check
 * loudly).
 */
export function phaseTargetMsFromWPM(wpm: number): number {
	if (wpm <= 0) return Number.POSITIVE_INFINITY;
	return 12_000 / wpm;
}

/**
 * Check whether a bigram has met graduation criteria (spec §4.1).
 */
export function checkBigramGraduation(input: GraduationInput): GraduationResult {
	const minSample = input.minSampleSize ?? DEFAULT_MIN_SAMPLE_SIZE;
	const minCorrect = input.minAccuracyCorrect ?? DEFAULT_MIN_ACCURACY_CORRECT;
	const speedWindow = input.speedWindow ?? DEFAULT_SPEED_WINDOW;
	const tol = input.speedToleranceRatio ?? DEFAULT_SPEED_TOLERANCE;

	const sample = input.recent.slice(-minSample);
	const sampleSize = sample.length;

	// Accuracy tally runs over the full sample; speed tally runs over the
	// tail `speedWindow`. Both counts are always reported back in `details`
	// so the UI can surface "12/15 correct, 3/5 within pace" even when the
	// result is `not yet`.
	let correct = 0;
	for (const o of sample) if (o.correct) correct++;

	const speedTail = sample.slice(-speedWindow);
	let within = 0;
	for (const o of speedTail) {
		// One-sided tolerance: pass iff transitionMs ≤ target × (1 + tol).
		// Anything faster than target is within tolerance by definition —
		// there's no upper bound on speed. Zero/Infinity target (non-
		// positive WPM) skips — `within` stays 0 and speed-off kicks in.
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
	// Every sample in the speed window must be within tolerance (spec
	// §4.1 says "last 5 are within …" — all five, not a majority).
	if (within < speedTail.length) {
		return { graduated: false, reason: 'speed-off', details };
	}
	return { graduated: true, reason: 'graduated', details };
}
