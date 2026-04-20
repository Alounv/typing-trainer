import type { KeystrokeEvent } from '../typing';

export const TARGET_WPM_MULTIPLIER = 1.17;

/** Wall-clock — mirrors session WPM so the pacer tracks sustained pace, not a pauses-stripped peak. */
export function deriveBaselineWPM(events: readonly KeystrokeEvent[]): number {
	if (events.length < 2) return 0;
	const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);
	const durationMs = sorted[sorted.length - 1].timestamp - sorted[0].timestamp;
	if (durationMs <= 0) return 0;
	const positions = new Set<number>();
	for (const e of sorted) positions.add(e.position);
	return positions.size / 5 / (durationMs / 60_000);
}

export function computeTargetWPM(baseline: number): number {
	return baseline * TARGET_WPM_MULTIPLIER;
}
