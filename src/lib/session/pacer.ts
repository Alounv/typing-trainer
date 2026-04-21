import type { DrillMode } from '../core';

export const SPEED_PACE_MULTIPLIER = 1;

/**
 * Pace for the ghost cursor, in WPM. Only speed drills get a pacer —
 * accuracy drills removed it so the user focuses on mistake count, not
 * a visible pace target. Returns 0 when the ghost should not render
 * (no diagnostic baseline, or non-speed mode).
 */
export function paceForMode(mode: DrillMode, baselineWPM: number): number {
	if (baselineWPM <= 0 || mode !== 'speed') return 0;
	return baselineWPM * SPEED_PACE_MULTIPLIER;
}

/** Floors to int (single-char highlight). Returns 0 for non-positive inputs so ghost never falls behind the user. */
export function computeGhostPosition(elapsedMs: number, paceWPM: number): number {
	if (elapsedMs <= 0 || paceWPM <= 0) return 0;
	const charsPerMs = (paceWPM * 5) / 60_000;
	return Math.floor(elapsedMs * charsPerMs);
}
