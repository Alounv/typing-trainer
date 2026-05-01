import type {
	BigramAggregate,
	BigramClassification,
	ClassificationThresholds,
	SessionSummary
} from '../support/core';
import type { FrequencyTable } from '../corpus';
import { summarizeBigrams } from '../skill';

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
const WPM_ROLLING_WINDOW = 7;
/** Sparkline depth — number of sliding-window points to plot per bigram. */
const BIGRAM_SPARKLINE_DEPTH = 10;
/** Window size for the sliding-window sparkline. Matches `BIGRAM_CLASSIFICATION_WINDOW`
 *  so the last point equals the value shown in the table cell. */
const BIGRAM_SPARKLINE_WINDOW = 10;

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

/** Local-date key (YYYY-MM-DD) for grouping sessions into "days". */
function localDateKey(timestamp: number): string {
	const d = new Date(timestamp);
	return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/**
 * Cumulative healthy-bigram count over time, one point per day (last session of the
 * day). The classifier runs on the full history up to and including that session, so
 * intra-day sessions still feed the count — they just don't get their own dot. Sets
 * `rolling = value` so the chart connects the dots; the count itself is the signal.
 */
export function buildHealthyBigramSeries(
	sessions: readonly SessionSummary[],
	corpus: FrequencyTable | undefined,
	thresholds: ClassificationThresholds
): TrendPoint[] {
	const ordered = [...sessions].sort((a, b) => a.timestamp - b.timestamp);
	const lastOfDayIdx = new Map<string, number>();
	for (let i = 0; i < ordered.length; i++) {
		lastOfDayIdx.set(localDateKey(ordered[i].timestamp), i);
	}
	const keep = new Set(lastOfDayIdx.values());

	const out: TrendPoint[] = [];
	for (let i = 0; i < ordered.length; i++) {
		if (!keep.has(i)) continue;
		const prefix = ordered.slice(0, i + 1);
		const rows = summarizeBigrams(prefix, corpus, thresholds);
		let healthy = 0;
		for (const r of rows) if (r.classification === 'healthy') healthy++;
		out.push({
			sessionId: ordered[i].id,
			timestamp: ordered[i].timestamp,
			value: healthy,
			rolling: healthy,
			plus1Sigma: null,
			minus1Sigma: null
		});
	}
	return out;
}

/** One point on a per-bigram sparkline. Each point is a rolling-window summary
 *  over `BIGRAM_SPARKLINE_WINDOW` consecutive occurrences. */
export interface BigramTrendPoint {
	meanTime: number;
	errorRate: number;
}

/**
 * Pool the most recent samples for `bigram` in chronological order (oldest →
 * newest). Walks sessions newest-first and prepends each session's tail so
 * sessions arrive newest-first while samples within a session keep their
 * original observation order. Stops once `limit` samples have been collected.
 */
function poolRecentSamples(
	sessions: readonly SessionSummary[],
	bigram: string,
	limit: number
): { correct: boolean; timing: number | null }[] {
	const ordered = [...sessions].sort((a, b) => b.timestamp - a.timestamp);
	const pool: { correct: boolean; timing: number | null }[] = [];
	for (const s of ordered) {
		const agg = s.bigramAggregates.find((a) => a.bigram === bigram);
		if (!agg || !agg.samples) continue;
		const remaining = limit - pool.length;
		if (remaining <= 0) break;
		const tail = agg.samples.slice(Math.max(0, agg.samples.length - remaining));
		pool.unshift(...tail);
		if (pool.length >= limit) break;
	}
	return pool;
}

/**
 * Sliding-window trend: pool the most recent `window + depth - 1` occurrences,
 * then slide a `window`-sized window across them, emitting one point per
 * position. The last point's metrics equal those shown in the table cell.
 *
 * Returns `[]` when the pool can't fill a single window — the sparkline then
 * falls back to its empty state.
 */
export function buildBigramTrend(
	sessions: readonly SessionSummary[],
	bigram: string,
	window: number = BIGRAM_SPARKLINE_WINDOW,
	depth: number = BIGRAM_SPARKLINE_DEPTH
): BigramTrendPoint[] {
	const samples = poolRecentSamples(sessions, bigram, window + depth - 1);
	if (samples.length < window) return [];
	const points: BigramTrendPoint[] = [];
	for (let end = window; end <= samples.length; end++) {
		const slice = samples.slice(end - window, end);
		const errorCount = slice.reduce((n, s) => n + (s.correct ? 0 : 1), 0);
		const timings = slice.map((s) => s.timing).filter((t): t is number => t !== null);
		points.push({
			meanTime: timings.length === 0 ? NaN : timings.reduce((a, b) => a + b, 0) / timings.length,
			errorRate: errorCount / slice.length
		});
	}
	return points;
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
