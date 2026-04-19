import type { BigramAggregate, BigramClassification } from '../bigram/types';
import type { SessionSummary } from '../session/types';
import type { FrequencyTable } from '../corpus/types';
import { DEFAULT_THRESHOLDS, type ClassificationThresholds } from '../bigram/classification';

/**
 * Rolling average with a trailing window. For positions before the window is
 * full, returns `null` — charts render these as gaps rather than misleading
 * partial averages. Window of 1 degenerates to the raw series.
 */
export function rollingAverage(values: readonly number[], window: number): (number | null)[] {
	if (window < 1) throw new RangeError('window must be ≥ 1');
	const out: (number | null)[] = [];
	let sum = 0;
	for (let i = 0; i < values.length; i++) {
		sum += values[i];
		if (i >= window) sum -= values[i - window];
		// Only emit once we have `window` samples behind us.
		out.push(i + 1 >= window ? sum / Math.min(window, i + 1) : null);
	}
	return out;
}

/**
 * Trailing-window sample standard deviation (n-1 denominator). Returns `null`
 * for positions before the window is full. Used to draw the ±1σ envelope on
 * the WPM chart — sample SD matches what a user would compute "by hand" on
 * recent sessions, which is how the envelope is interpreted.
 */
export function rollingStdDev(values: readonly number[], window: number): (number | null)[] {
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
		// Sample SD: n-1 denominator. With window=1 this degenerates to 0/0 → 0.
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
export const BIGRAM_SPARKLINE_DEPTH = 8;

/**
 * Single point on a per-session trend chart. Shared shape across metrics so
 * one chart component can render WPM, error rate, or any future scalar —
 * "never show raw X alone" is a spec-wide principle, not a WPM-specific one.
 */
export interface TrendPoint {
	sessionId: string;
	timestamp: number;
	/** Raw per-session value (WPM, errorRate, …). */
	value: number;
	/** Rolling mean of last `WPM_ROLLING_WINDOW` sessions, or `null` before the window fills. */
	rolling: number | null;
	/** Upper bound of ±1σ band — `null` until enough samples. */
	plus1Sigma: number | null;
	/** Lower bound of ±1σ band — `null` until enough samples. */
	minus1Sigma: number | null;
}

/** Back-compat alias — WpmPoint is just a TrendPoint. Kept so the chart
 * component keeps compiling while we migrate call sites. */
export type WpmPoint = TrendPoint & { wpm: number };

/**
 * Generic trend builder. Sessions can be in any order; the series is emitted
 * oldest-first so rolling windows look at the past, not the future.
 */
export function buildMetricSeries(
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

/** WPM series convenience. Adds a `wpm` alias on each point so existing
 * call sites that destructure `wpm` keep working. */
export function buildWpmSeries(sessions: readonly SessionSummary[]): WpmPoint[] {
	return buildMetricSeries(sessions, (s) => s.wpm).map((p) => ({ ...p, wpm: p.value }));
}

/** Per-session error rate series. */
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
 * Extract the last N sessions' mean-time trend for a single bigram. Sessions
 * that didn't observe the bigram are simply skipped (no gaps emitted).
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
		// Skip sessions where we didn't have a clean sample — drawing a flat
		// line at 0 or NaN would be worse than a shorter series.
		if (!agg || !Number.isFinite(agg.meanTime)) continue;
		points.push({
			sessionId: s.id,
			timestamp: s.timestamp,
			meanTime: agg.meanTime,
			errorRate: agg.errorRate
		});
	}
	// Trim to last `depth` points — series is already oldest-first.
	return points.slice(-depth);
}

/**
 * Summary row powering the bigram table. Built from the most recent
 * classification snapshot, with a backward-looking slope of mean transition
 * time to drive the trend column.
 */
export interface BigramSummary {
	bigram: string;
	classification: BigramClassification;
	meanTime: number;
	errorRate: number;
	occurrences: number;
	/**
	 * Product of `badness × corpus frequency`. Default sort key — this is what
	 * makes "worst bigrams the user actually hits" bubble up.
	 */
	priorityScore: number;
	/** Recent mean-time trend, ready to feed a sparkline component. */
	trend: BigramTrendPoint[];
}

/**
 * Aggregate all observed bigrams across the given sessions into table rows.
 * For each bigram, the `classification`/`meanTime`/`errorRate` come from the
 * most recent session that observed it (the latest snapshot the user has seen);
 * `occurrences` sums across all sessions (lifetime count, so rare bigrams
 * don't look exaggeratedly fresh).
 */
export function summarizeBigrams(
	sessions: readonly SessionSummary[],
	corpus?: FrequencyTable,
	thresholds: ClassificationThresholds = DEFAULT_THRESHOLDS
): BigramSummary[] {
	// Sessions oldest-first so the final pass overwrites with the newest snapshot.
	const ordered = [...sessions].sort((a, b) => a.timestamp - b.timestamp);

	const latest = new Map<string, BigramAggregate>();
	const occurrences = new Map<string, number>();
	for (const s of ordered) {
		for (const agg of s.bigramAggregates) {
			latest.set(agg.bigram, agg);
			occurrences.set(agg.bigram, (occurrences.get(agg.bigram) ?? 0) + agg.occurrences);
		}
	}

	const rows: BigramSummary[] = [];
	for (const [bigram, agg] of latest) {
		const trend = buildBigramTrend(sessions, bigram);
		const badness = badness1D(agg, thresholds);
		const freq = corpus?.[bigram] ?? 1;
		rows.push({
			bigram,
			classification: agg.classification,
			meanTime: agg.meanTime,
			errorRate: agg.errorRate,
			occurrences: occurrences.get(bigram) ?? agg.occurrences,
			priorityScore: badness * freq,
			trend
		});
	}

	// Default sort: highest priority first. Components can re-sort as needed.
	rows.sort((a, b) => b.priorityScore - a.priorityScore);
	return rows;
}

/**
 * Single-bigram badness scalar. Duplicated (narrowly) from `diagnostic/engine`
 * because that copy is private and per-diagnostic — the analytics view wants
 * the same formula applied to any BigramAggregate. If these ever drift, the
 * table and the diagnostic priority list will stop agreeing.
 */
function badness1D(agg: BigramAggregate, thresholds: ClassificationThresholds): number {
	const slowRatio = Number.isFinite(agg.meanTime)
		? Math.max(0, agg.meanTime / thresholds.speedMs - 1)
		: 0;
	// Same 10× weight as diagnostic engine: 10% error ≈ 1.0 of badness.
	return slowRatio + agg.errorRate * 10;
}

/**
 * Count how many bigrams transitioned into `healthy` between two diagnostic
 * reports — driven off the latest snapshot in each set. A bigram that wasn't
 * present in the "before" set but is healthy in "after" counts as a
 * graduation; a bigram that regressed does not.
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
