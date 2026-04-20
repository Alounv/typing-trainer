import type { DrillMode } from '../core';

/** Accuracy drills push *below* baseline — hasty/acquisition bigrams need slow-down pressure, not speed-up. */
export const ACCURACY_PACE_MULTIPLIER = 0.6;

/** Mirrors `TARGET_WPM_MULTIPLIER` in `diagnostic/pacing.ts`. Separate constants so the two callers can't silently diverge. */
export const SPEED_PACE_MULTIPLIER = 1;

/** Returns 0 when baseline is unusable (first-run, no diagnostic); caller skips ghost rendering. */
export function paceForMode(mode: DrillMode, baselineWPM: number): number {
	if (baselineWPM <= 0) return 0;
	const multiplier = mode === 'accuracy' ? ACCURACY_PACE_MULTIPLIER : SPEED_PACE_MULTIPLIER;
	return baselineWPM * multiplier;
}

/** Floors to int (single-char highlight). Returns 0 for non-positive inputs so ghost never falls behind the user. */
export function computeGhostPosition(elapsedMs: number, paceWPM: number): number {
	if (elapsedMs <= 0 || paceWPM <= 0) return 0;
	const charsPerMs = (paceWPM * 5) / 60_000;
	return Math.floor(elapsedMs * charsPerMs);
}
