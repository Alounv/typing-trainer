import type { DrillMode } from '../core';

/**
 * Pacer driver. Pure helpers — a real-time ghost cursor position derived from
 * wall-clock ms elapsed since the user's first keystroke, plus the mode-specific
 * WPM target. The rendering (a secondary highlight on `ghostPosition`) lives
 * in `TextDisplay.svelte`; the reactive wiring in `SessionShell.svelte`.
 *
 * Why a separate file: keeps the math unit-testable in plain TS, and keeps
 * SessionShell focused on wiring runner events → UI state. Also makes it
 * obvious where to tune the mode multipliers if the spec changes.
 */

/**
 * Accuracy-mode multiplier: `baselineWPM × this`. 0.60 comes from spec.md §3.7 —
 * hasty/acquisition bigrams drill below the user's current baseline so the
 * pacer exerts *slow-down* pressure, not speed-up.
 */
export const ACCURACY_PACE_MULTIPLIER = 0.6;

/**
 * Speed-mode multiplier: `baselineWPM × this`. Matches `TARGET_WPM_MULTIPLIER`
 * in `diagnostic/pacing.ts` by design — fluency bigrams push toward the same
 * targetWPM the diagnostic report already surfaces. Kept as its own constant
 * here so the two callers don't fight over a shared name if one drifts.
 */
export const SPEED_PACE_MULTIPLIER = 1;

/**
 * Pacer WPM for a drill session. Returns 0 when inputs are unusable — the
 * caller then skips ghost-position rendering (baseline of 0 means no
 * diagnostic on file, which is the first-run case).
 */
export function paceForMode(mode: DrillMode, baselineWPM: number): number {
	if (baselineWPM <= 0) return 0;
	const multiplier = mode === 'accuracy' ? ACCURACY_PACE_MULTIPLIER : SPEED_PACE_MULTIPLIER;
	return baselineWPM * multiplier;
}

/**
 * Ghost cursor char index given wall-clock ms elapsed and a target WPM.
 * 5 chars = 1 word; chars-per-ms = WPM × 5 / 60_000. Floors to an integer
 * index because `TextDisplay` renders a single-character highlight.
 *
 * Returns 0 for non-positive inputs so the UI never shows a ghost *behind*
 * the user (the render layer also guards against ghost ≤ position).
 */
export function computeGhostPosition(elapsedMs: number, paceWPM: number): number {
	if (elapsedMs <= 0 || paceWPM <= 0) return 0;
	const charsPerMs = (paceWPM * 5) / 60_000;
	return Math.floor(elapsedMs * charsPerMs);
}
