/** Per-bigram difficulty scoring for the optional pending-letter colorizer. */
import type { BigramAggregate } from '$lib/support/core';

export type DifficultyMode = 'errors' | 'speed';

interface Pooled {
	occurrences: number;
	errorCount: number;
	weightedTimeSum: number;
	timingWeight: number;
}

function pool(aggregates: readonly BigramAggregate[]): Map<string, Pooled> {
	const out = new Map<string, Pooled>();
	for (const agg of aggregates) {
		const cur = out.get(agg.bigram) ?? {
			occurrences: 0,
			errorCount: 0,
			weightedTimeSum: 0,
			timingWeight: 0
		};
		cur.occurrences += agg.occurrences;
		cur.errorCount += agg.errorCount;
		// meanTime is over clean pairs only; weight by clean-pair count.
		const cleanWeight = Math.max(0, agg.occurrences - agg.errorCount);
		if (cleanWeight > 0 && Number.isFinite(agg.meanTime)) {
			cur.weightedTimeSum += agg.meanTime * cleanWeight;
			cur.timingWeight += cleanWeight;
		}
		out.set(agg.bigram, cur);
	}
	return out;
}

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

// Bigrams below the floor get no tint; at or above the ceiling, full warning color.
const ERROR_RATE_FLOOR = 0.02;
const ERROR_RATE_CEILING = 0.1;

export function buildDifficultyMap(
	aggregates: readonly BigramAggregate[],
	mode: DifficultyMode,
	minOccurrences = 5
): Map<string, number> {
	const pooled = pool(aggregates);
	const out = new Map<string, number>();

	if (mode === 'errors') {
		for (const [bigram, p] of pooled) {
			if (p.occurrences < minOccurrences) continue;
			const errorRate = p.errorCount / p.occurrences;
			const score = (errorRate - ERROR_RATE_FLOOR) / (ERROR_RATE_CEILING - ERROR_RATE_FLOOR);
			out.set(bigram, clamp01(score));
		}
		return out;
	}

	const meanTimes: [string, number][] = [];
	for (const [bigram, p] of pooled) {
		if (p.occurrences < minOccurrences) continue;
		if (p.timingWeight > 0) {
			meanTimes.push([bigram, p.weightedTimeSum / p.timingWeight]);
		}
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
