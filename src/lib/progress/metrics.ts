import {
	BIGRAM_CLASSIFICATION_WINDOW,
	DEFAULT_THRESHOLDS,
	RECENT_WINDOW,
	type BigramClassification,
	type BigramSample,
	type ClassificationThresholds,
	type SessionSummary
} from '../support/core';
import { classifyBigram, summarizeSamples, type BigramSummary } from '../skill';

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

/** Sparkline width matches the classifier window so the rightmost point equals the
 *  table cell, and the depth shows the same number of windows of history. */
const BIGRAM_SPARKLINE_WINDOW = BIGRAM_CLASSIFICATION_WINDOW;
const BIGRAM_SPARKLINE_DEPTH = BIGRAM_CLASSIFICATION_WINDOW;
/** Total samples per bigram needed to render a full sparkline. */
const BIGRAM_SPARKLINE_SAMPLE_LIMIT = BIGRAM_SPARKLINE_WINDOW + BIGRAM_SPARKLINE_DEPTH - 1;

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

/** What collapses into one plotted point. Per-session buckets hold one value;
 *  per-day buckets hold however many sessions that day held. `id` is the chart
 *  key — the day's last session, when bucketing by day. */
interface Bucket {
	id: string;
	timestamp: number;
	values: number[];
}

/** Buckets → points: median per bucket, then a trailing rolling mean and ±1σ
 *  across them. Only multi-sample buckets get a whisker, which is why the
 *  per-session series never shows one. */
/**
 * Days, not sessions — the daily charts bucket by date, so this is a week.
 * Deliberately not {@link RECENT_WINDOW}: that counts sessions, and twenty days
 * of smoothing would flatten a chart whose whole job is showing movement.
 */
export const TREND_SMOOTHING_DAYS = 7;

function buildSeries(buckets: readonly Bucket[], window: number): TrendPoint[] {
	const values = buckets.map((b) => median(b.values));
	const rolling = rollingAverage(values, window);
	const sigmas = rollingStdDev(values, window);

	return buckets.map((bucket, i) => {
		const mean = rolling[i];
		const sd = sigmas[i];
		const spread = mean !== null && sd !== null;
		const multi = bucket.values.length > 1;
		return {
			sessionId: bucket.id,
			timestamp: bucket.timestamp,
			value: values[i],
			rolling: mean,
			plus1Sigma: spread ? mean + sd : null,
			minus1Sigma: spread ? mean - sd : null,
			low: multi ? Math.min(...bucket.values) : null,
			high: multi ? Math.max(...bucket.values) : null
		};
	});
}

function chronological(sessions: readonly SessionSummary[]): SessionSummary[] {
	return [...sessions].sort((a, b) => a.timestamp - b.timestamp);
}

function perSession(
	sessions: readonly SessionSummary[],
	accessor: (s: SessionSummary) => number
): Bucket[] {
	return chronological(sessions).map((s) => ({
		id: s.id,
		timestamp: s.timestamp,
		values: [accessor(s)]
	}));
}

/** One bucket per local day — the median suppresses intra-day noise without
 *  flattening real progress. */
function perDay(
	sessions: readonly SessionSummary[],
	accessor: (s: SessionSummary) => number
): Bucket[] {
	const byDay = new Map<string, SessionSummary[]>();
	for (const s of chronological(sessions)) {
		const key = localDateKey(s.timestamp);
		const bucket = byDay.get(key);
		if (bucket) bucket.push(s);
		else byDay.set(key, [s]);
	}
	return [...byDay.values()].map((day) => {
		const last = day[day.length - 1];
		return { id: last.id, timestamp: last.timestamp, values: day.map(accessor) };
	});
}

export function buildWpmSeries(sessions: readonly SessionSummary[]): TrendPoint[] {
	return buildSeries(
		perSession(sessions, (s) => s.wpm),
		RECENT_WINDOW
	);
}

export function buildDailyWpmSeries(sessions: readonly SessionSummary[]): TrendPoint[] {
	return buildSeries(
		perDay(sessions, (s) => s.wpm),
		TREND_SMOOTHING_DAYS
	);
}

export function buildDailyErrorRateSeries(sessions: readonly SessionSummary[]): TrendPoint[] {
	return buildSeries(
		perDay(sessions, (s) => s.errorRate),
		TREND_SMOOTHING_DAYS
	);
}

/** Local-date key for grouping sessions into "days". */
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
 * Two cumulative counts in one pass, one point per day: bigrams currently
 * classified `healthy`, and every bigram past the initial-learning phase
 * (healthy + fluency + hasty). The chart draws both, so the gap between them
 * reads as in-progress practice.
 */
export function buildBigramProgressSeries(
	sessions: readonly SessionSummary[],
	thresholds: ClassificationThresholds = DEFAULT_THRESHOLDS
): { healthy: TrendPoint[]; beyondAcquisition: TrendPoint[] } {
	const ordered = chronological(sessions);
	const lastOfDayIdx = new Map<string, number>();
	for (let i = 0; i < ordered.length; i++) {
		lastOfDayIdx.set(localDateKey(ordered[i].timestamp), i);
	}
	const keep = new Set(lastOfDayIdx.values());

	const buffers = new Map<string, BigramSample[]>();
	const window = BIGRAM_CLASSIFICATION_WINDOW;

	const healthy: TrendPoint[] = [];
	const beyondAcquisition: TrendPoint[] = [];

	function emit(series: TrendPoint[], sessionId: string, timestamp: number, value: number) {
		series.push({
			sessionId,
			timestamp,
			value,
			rolling: value,
			plus1Sigma: null,
			minus1Sigma: null,
			low: null,
			high: null
		});
	}

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

		let healthyCount = 0;
		let beyondCount = 0;
		for (const buf of buffers.values()) {
			if (buf.length === 0) continue;
			const { meanTime, errorRate } = summarizeSamples(buf);
			const cls = classifyBigram({ occurrences: buf.length, meanTime, errorRate }, thresholds);
			if (cls === 'healthy') {
				healthyCount++;
				beyondCount++;
			} else if (cls === 'fluency' || cls === 'hasty') {
				beyondCount++;
			}
		}

		emit(healthy, ordered[i].id, ordered[i].timestamp, healthyCount);
		emit(beyondAcquisition, ordered[i].id, ordered[i].timestamp, beyondCount);
	}
	return { healthy, beyondAcquisition };
}

/** One point on a per-bigram sparkline. Each point is a rolling-window summary
 *  over `BIGRAM_SPARKLINE_WINDOW` consecutive occurrences. */
export interface BigramTrendPoint {
	meanTime: number;
	errorRate: number;
}

/** Per-bigram buffer of the most recent `limit` samples (oldest→newest). One pass over
 *  sessions; used to batch trend computation for many bigrams. */
function buildRecentSamplesIndex(
	sessions: readonly SessionSummary[],
	limit: number
): Map<string, BigramSample[]> {
	const out = new Map<string, BigramSample[]>();
	for (const s of chronological(sessions)) {
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

/** Sliding-window trend from a pre-built sample buffer. */
function buildBigramTrendFromSamples(
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

/** A table row: skill's per-bigram assessment plus the sparkline trend. */
export type BigramRow = BigramSummary & { trend: BigramTrendPoint[] };

/**
 * Attach a sparkline trend to each summary. The sample index is built once for
 * the whole set rather than per row — the pool is the same for every bigram, and
 * rebuilding it per row is quadratic in the number of bigrams observed.
 */
export function buildBigramRows(
	sessions: readonly SessionSummary[],
	summaries: readonly BigramSummary[]
): BigramRow[] {
	const index = buildRecentSamplesIndex(sessions, BIGRAM_SPARKLINE_SAMPLE_LIMIT);
	return summaries.map((row) => ({
		...row,
		trend: buildBigramTrendFromSamples(index.get(row.bigram) ?? [])
	}));
}

/**
 * Bucketed counts across the four classified states. `unclassified` surfaces
 * separately — it isn't a ladder point.
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
