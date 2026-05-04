import {
	BIGRAM_CLASSIFICATION_WINDOW,
	type BigramAggregate,
	type BigramClassification,
	type BigramSample,
	type ClassificationThresholds,
	type SessionSummary
} from '../support/core';
import type { FrequencyTable } from '../corpus';
import { classifyBigram } from '../skill';

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
/** Sparkline width matches the classifier window so the rightmost point equals the
 *  table cell, and the depth shows the same number of windows of history. */
const BIGRAM_SPARKLINE_WINDOW = BIGRAM_CLASSIFICATION_WINDOW;
const BIGRAM_SPARKLINE_DEPTH = BIGRAM_CLASSIFICATION_WINDOW;
/** Total samples per bigram needed to render a full sparkline. */
export const BIGRAM_SPARKLINE_SAMPLE_LIMIT = BIGRAM_SPARKLINE_WINDOW + BIGRAM_SPARKLINE_DEPTH - 1;

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
	/**
	 * Intra-bucket spread (e.g. min/max across a day's diagnostics). Both `null`
	 * for buckets with a single sample, since a whisker over one point is noise.
	 */
	low: number | null;
	high: number | null;
}

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
			minus1Sigma: mean !== null && sd !== null ? mean - sd : null,
			low: null,
			high: null
		};
	});
}

export function buildWpmSeries(sessions: readonly SessionSummary[]): TrendPoint[] {
	return buildMetricSeries(sessions, (s) => s.wpm);
}

/** Local-date key (YYYY-MM-DD) for grouping sessions into "days". */
function localDateKey(timestamp: number): string {
	const d = new Date(timestamp);
	return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function median(values: readonly number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	const n = sorted.length;
	return n % 2 === 1 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
}

/**
 * Collapse sessions into one point per local day, taking the median of the chosen
 * scalar across the day's sessions. The day's last session supplies the timestamp
 * and id (stable key, chronological position). Used by the analytics charts to
 * suppress intra-day noise without flattening real progress.
 */
function buildDailyMedianSeries(
	sessions: readonly SessionSummary[],
	accessor: (s: SessionSummary) => number
): TrendPoint[] {
	const ordered = [...sessions].sort((a, b) => a.timestamp - b.timestamp);
	const byDay = new Map<string, SessionSummary[]>();
	for (const s of ordered) {
		const key = localDateKey(s.timestamp);
		const bucket = byDay.get(key);
		if (bucket) bucket.push(s);
		else byDay.set(key, [s]);
	}
	const days = [...byDay.values()];
	const dayValues = days.map((bucket) => bucket.map(accessor));
	const values = dayValues.map((vs) => median(vs));
	const rolling = rollingAverage(values, WPM_ROLLING_WINDOW);
	const sigmas = rollingStdDev(values, WPM_ROLLING_WINDOW);
	return days.map((bucket, i) => {
		const last = bucket[bucket.length - 1];
		const mean = rolling[i];
		const sd = sigmas[i];
		const vs = dayValues[i];
		const multi = vs.length > 1;
		return {
			sessionId: last.id,
			timestamp: last.timestamp,
			value: values[i],
			rolling: mean,
			plus1Sigma: mean !== null && sd !== null ? mean + sd : null,
			minus1Sigma: mean !== null && sd !== null ? mean - sd : null,
			low: multi ? Math.min(...vs) : null,
			high: multi ? Math.max(...vs) : null
		};
	});
}

export function buildDailyWpmSeries(sessions: readonly SessionSummary[]): TrendPoint[] {
	return buildDailyMedianSeries(sessions, (s) => s.wpm);
}

export function buildDailyErrorRateSeries(sessions: readonly SessionSummary[]): TrendPoint[] {
	return buildDailyMedianSeries(sessions, (s) => s.errorRate);
}

/**
 * Cumulative healthy-bigram count, one point per day (last session of the day).
 * Intra-day sessions still feed the rolling buffer; only the last gets its own dot.
 * Sets `rolling = value` so the chart connects the dots.
 */
export function buildHealthyBigramSeries(
	sessions: readonly SessionSummary[],
	_corpus: FrequencyTable | undefined,
	thresholds: ClassificationThresholds
): TrendPoint[] {
	const ordered = [...sessions].sort((a, b) => a.timestamp - b.timestamp);
	const lastOfDayIdx = new Map<string, number>();
	for (let i = 0; i < ordered.length; i++) {
		lastOfDayIdx.set(localDateKey(ordered[i].timestamp), i);
	}
	const keep = new Set(lastOfDayIdx.values());

	const buffers = new Map<string, BigramSample[]>();
	const window = BIGRAM_CLASSIFICATION_WINDOW;

	const out: TrendPoint[] = [];
	for (let i = 0; i < ordered.length; i++) {
		const s = ordered[i];
		for (const agg of s.bigramAggregates) {
			if (!agg.samples || agg.samples.length === 0) continue;
			let buf = buffers.get(agg.bigram);
			if (!buf) {
				buf = [];
				buffers.set(agg.bigram, buf);
			}
			for (const sample of agg.samples) buf.push(sample);
			if (buf.length > window) buf.splice(0, buf.length - window);
		}

		if (!keep.has(i)) continue;

		let healthy = 0;
		for (const buf of buffers.values()) {
			if (buf.length === 0) continue;
			let timingSum = 0;
			let timingCount = 0;
			let errorCount = 0;
			for (const sample of buf) {
				if (sample.timing !== null) {
					timingSum += sample.timing;
					timingCount++;
				}
				if (!sample.correct) errorCount++;
			}
			const meanTime = timingCount === 0 ? NaN : timingSum / timingCount;
			const errorRate = errorCount / buf.length;
			const cls = classifyBigram({ occurrences: buf.length, meanTime, errorRate }, thresholds);
			if (cls === 'healthy') healthy++;
		}

		out.push({
			sessionId: ordered[i].id,
			timestamp: ordered[i].timestamp,
			value: healthy,
			rolling: healthy,
			plus1Sigma: null,
			minus1Sigma: null,
			low: null,
			high: null
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

/** Per-bigram buffer of the most recent `limit` samples (oldest→newest). One pass over
 *  sessions; used to batch trend computation for many bigrams. */
export function buildRecentSamplesIndex(
	sessions: readonly SessionSummary[],
	limit: number
): Map<string, BigramSample[]> {
	const ordered = [...sessions].sort((a, b) => a.timestamp - b.timestamp);
	const out = new Map<string, BigramSample[]>();
	for (const s of ordered) {
		for (const agg of s.bigramAggregates) {
			if (!agg.samples || agg.samples.length === 0) continue;
			let buf = out.get(agg.bigram);
			if (!buf) {
				buf = [];
				out.set(agg.bigram, buf);
			}
			for (const sample of agg.samples) buf.push(sample);
			if (buf.length > limit) buf.splice(0, buf.length - limit);
		}
	}
	return out;
}

/** Sliding-window trend from a pre-built sample buffer. Use when deriving trends for
 *  many bigrams; pair with `buildRecentSamplesIndex`. */
export function buildBigramTrendFromSamples(
	samples: readonly BigramSample[],
	window: number = BIGRAM_SPARKLINE_WINDOW
): BigramTrendPoint[] {
	if (samples.length < window) return [];
	const points: BigramTrendPoint[] = [];
	for (let end = window; end <= samples.length; end++) {
		let timingSum = 0;
		let timingCount = 0;
		let errorCount = 0;
		for (let k = end - window; k < end; k++) {
			const s = samples[k];
			if (s.timing !== null) {
				timingSum += s.timing;
				timingCount++;
			}
			if (!s.correct) errorCount++;
		}
		points.push({
			meanTime: timingCount === 0 ? NaN : timingSum / timingCount,
			errorRate: errorCount / window
		});
	}
	return points;
}

/**
 * Sliding-window trend for one bigram. Returns `[]` when the pool can't fill a single
 * window. For many bigrams off the same session set, call `buildRecentSamplesIndex`
 * once and feed `buildBigramTrendFromSamples` instead.
 */
export function buildBigramTrend(
	sessions: readonly SessionSummary[],
	bigram: string,
	window: number = BIGRAM_SPARKLINE_WINDOW,
	depth: number = BIGRAM_SPARKLINE_DEPTH
): BigramTrendPoint[] {
	const idx = buildRecentSamplesIndex(sessions, window + depth - 1);
	return buildBigramTrendFromSamples(idx.get(bigram) ?? [], window);
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
