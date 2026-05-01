/** Per-bigram difficulty scoring for the optional pending-letter colorizer. */
import type { BigramSummary } from '$lib/skill';

export type DifficultyMode = 'errors' | 'speed';

/** Percentile rank in [0, 1]; highest value gets 1, lowest gets 0. */
function percentileRanks(entries: ReadonlyArray<[string, number]>): Map<string, number> {
	const out = new Map<string, number>();
	if (entries.length === 0) return out;
	if (entries.length === 1) {
		out.set(entries[0][0], 0.5);
		return out;
	}
	const sorted = [...entries].sort((a, b) => a[1] - b[1]);
	const n = sorted.length;
	for (let i = 0; i < n; i++) {
		out.set(sorted[i][0], i / (n - 1));
	}
	return out;
}

const ERROR_RATE_CEILING = 0.1;

/** Reads errorRate / meanTime off the rolling-window summary, gated by the same
 *  classifier (and therefore the same `BIGRAM_CLASSIFICATION_WINDOW` /
 *  `MIN_OCCURRENCES_FOR_CLASSIFICATION`) that the rest of the app uses. */
export function buildDifficultyMap(
	summaries: readonly BigramSummary[],
	mode: DifficultyMode
): Map<string, number> {
	const out = new Map<string, number>();

	if (mode === 'errors') {
		for (const s of summaries) {
			if (s.classification === 'unclassified') continue;
			const score = s.errorRate / ERROR_RATE_CEILING;
			out.set(s.bigram, clamp01(score));
		}
		return out;
	}

	const meanTimes: [string, number][] = [];
	for (const s of summaries) {
		if (s.classification === 'unclassified') continue;
		meanTimes.push([s.bigram, s.meanTime]);
	}

	const speedRanks = percentileRanks(meanTimes);
	for (const [bigram] of meanTimes) {
		const rank = speedRanks.get(bigram);
		if (rank === undefined) continue;
		// Cubic curve so only the top decile pops; rank² spread tint too widely.
		out.set(bigram, clamp01(rank * rank * rank * rank));
	}

	return out;
}

function clamp01(v: number): number {
	if (!Number.isFinite(v)) return 0;
	return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Lerp from faded pending color to a DaisyUI token. The relative-color
 *  step bakes the 0.45 pending alpha into the easy end so the inline
 *  override doesn't strip the fade. */
export function difficultyToColor(score: number, highlightVar: string): string {
	const s = clamp01(score);
	const easyPct = (1 - s) * 100;
	const hardPct = s * 100;
	return `color-mix(in oklab, oklch(from currentColor l c h / 0.45) ${easyPct.toFixed(1)}%, var(${highlightVar}) ${hardPct.toFixed(1)}%)`;
}

/** Match the BigramClassification swatches in ClassificationBar:
 *  speed-drill targets fluency (info), accuracy-drill targets hasty (warning). */
export function highlightVarForMode(mode: DifficultyMode): string {
	return mode === 'speed' ? '--color-info' : '--color-warning';
}
