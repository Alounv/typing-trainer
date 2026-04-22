import type { BigramAggregate, BigramClassification, SessionSummary } from '../support/core';

/**
 * Rolling average with a trailing window. For positions before the window is full, returns
 * `null` — charts render these as gaps rather than misleading partial averages.
 */
function rollingAverage(values: readonly number[], window: number): (number | null)[] {
	if (window < 1) throw new RangeError('window must be ≥ 1');
	const out: (number | null)[] = [];
	let sum = 0;
	for (let i = 0; i < values.length; i++) {
		sum += values[i];
		if (i >= window) sum -= values[i - window];
		out.push(i + 1 >= window ? sum / Math.min(window, i + 1) : null);
	}
	return out;
}

/**
 * Trailing-window sample standard deviation (n-1 denominator). Returns `null` before the
 * window is full. Used for the ±1σ envelope on the WPM chart.
 */
function rollingStdDev(values: readonly number[], window: number): (number | null)[] {
	if (window < 1) throw new RangeError('window must be ≥ 1');
	const out: (number | null)[] = [];
	for (let i = 0; i < values.length; i++) {
		if (i + 1 < window) {
			out.push(null);
			continue;
		}
		const start = i - window + 1;
		const slice = values.slice(start, i + 1);
		const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
		const denom = slice.length - 1;
		if (denom === 0) {
			out.push(0);
			continue;
		}
		const variance = slice.reduce((acc, v) => acc + (v - mean) * (v - mean), 0) / denom;
		out.push(Math.sqrt(variance));
	}
	return out;
}

/** Smoothing window for WPM trend. Spec §10.6 calls for a 7-session average. */
export const WPM_ROLLING_WINDOW = 7;
/** Sparkline depth for per-bigram mean transition time. Spec §10.6. */
const BIGRAM_SPARKLINE_DEPTH = 8;

/**
 * Single point on a per-session trend chart. Shared shape across metrics so one chart
 * component can render WPM, error rate, or any future scalar.
 */
export interface TrendPoint {
	sessionId: string;
	timestamp: number;
	value: number;
	rolling: number | null;
	plus1Sigma: number | null;
	minus1Sigma: number | null;
}

/** Back-compat alias — `wpm` field kept so the chart component keeps compiling. */
export type WpmPoint = TrendPoint & { wpm: number };

function buildMetricSeries(
	sessions: readonly SessionSummary[],
	accessor: (s: SessionSummary) => number
): TrendPoint[] {
	const ordered = [...sessions].sort((a, b) => a.timestamp - b.timestamp);
	const values = ordered.map(accessor);
	const rolling = rollingAverage(values, WPM_ROLLING_WINDOW);
	const sigmas = rollingStdDev(values, WPM_ROLLING_WINDOW);
	return ordered.map((s, i) => {
		const mean = rolling[i];
		const sd = sigmas[i];
		return {
			sessionId: s.id,
			timestamp: s.timestamp,
			value: values[i],
			rolling: mean,
			plus1Sigma: mean !== null && sd !== null ? mean + sd : null,
			minus1Sigma: mean !== null && sd !== null ? mean - sd : null
		};
	});
}

export function buildWpmSeries(sessions: readonly SessionSummary[]): WpmPoint[] {
	return buildMetricSeries(sessions, (s) => s.wpm).map((p) => ({ ...p, wpm: p.value }));
}

export function buildErrorRateSeries(sessions: readonly SessionSummary[]): TrendPoint[] {
	return buildMetricSeries(sessions, (s) => s.errorRate);
}

/** One point on a per-bigram sparkline: session timestamp + mean transition time. */
export interface BigramTrendPoint {
	sessionId: string;
	timestamp: number;
	meanTime: number;
	errorRate: number;
}

/**
 * Extract the last N sessions' mean-time trend for a single bigram. Sessions that didn't
 * observe the bigram are skipped (no gaps emitted).
 */
export function buildBigramTrend(
	sessions: readonly SessionSummary[],
	bigram: string,
	depth: number = BIGRAM_SPARKLINE_DEPTH
): BigramTrendPoint[] {
	const points: BigramTrendPoint[] = [];
	const ordered = [...sessions].sort((a, b) => a.timestamp - b.timestamp);
	for (const s of ordered) {
		const agg = s.bigramAggregates.find((a) => a.bigram === bigram);
		if (!agg || !Number.isFinite(agg.meanTime)) continue;
		points.push({
			sessionId: s.id,
			timestamp: s.timestamp,
			meanTime: agg.meanTime,
			errorRate: agg.errorRate
		});
	}
	return points.slice(-depth);
}

/**
 * Bucketed counts across the four classified states. Shape-compatible with
 * `DiagnosticReport.counts` so the classification bar can take either a live tally or a
 * diagnostic snapshot. `unclassified` surfaces separately — it isn't a ladder point.
 */
interface ClassificationMix {
	counts: {
		healthy: number;
		fluency: number;
		hasty: number;
		acquisition: number;
	};
	unclassified: number;
}

/** Tally classification counts across a set of classified bigrams. */
export function tallyClassificationMix(
	bigrams: readonly { classification: BigramClassification }[]
): ClassificationMix {
	const mix: ClassificationMix = {
		counts: { healthy: 0, fluency: 0, hasty: 0, acquisition: 0 },
		unclassified: 0
	};
	for (const b of bigrams) {
		if (b.classification === 'unclassified') mix.unclassified++;
		else mix.counts[b.classification]++;
	}
	return mix;
}

/**
 * Count how many bigrams transitioned into `healthy` between two diagnostic snapshots.
 * A bigram absent from `before` but healthy in `after` counts; regressions don't.
 */
export function countGraduations(
	before: readonly BigramAggregate[],
	after: readonly BigramAggregate[]
): number {
	const beforeClass = new Map<string, BigramClassification>();
	for (const a of before) beforeClass.set(a.bigram, a.classification);
	let graduated = 0;
	for (const a of after) {
		if (a.classification !== 'healthy') continue;
		const prev = beforeClass.get(a.bigram);
		if (prev !== 'healthy') graduated++;
	}
	return graduated;
}
