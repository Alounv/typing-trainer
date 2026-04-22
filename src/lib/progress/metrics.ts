import type {
	BigramAggregate,
	BigramClassification,
	BigramSample,
	PriorityBigram,
	SessionSummary
} from '../core';
import {
	classifyBigram,
	DEFAULT_THRESHOLDS,
	MIN_OCCURRENCES_FOR_CLASSIFICATION,
	type ClassificationThresholds
} from '../skill';
import type { FrequencyTable } from '../corpus';

/** Mirrors `PRIORITY_TARGETS_TOP_N` in the diagnostic engine. */
const LIVE_PRIORITY_TARGETS_TOP_N = 10;

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
const BIGRAM_SPARKLINE_DEPTH = 8;

/** Pooled-samples window for per-bigram classification. Big enough to resist
 *  single-session outliers, small enough to track recent behavior. */
const BIGRAM_CLASSIFICATION_WINDOW = 50;

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

interface RollingBigramAggregate {
	occurrences: number;
	meanTime: number;
	errorRate: number;
}

/**
 * Pool the last `window` per-occurrence samples for `bigram`, newest session
 * first. Legacy sessions without `samples` are skipped. Returns `undefined`
 * when no session in the set carries samples for this bigram.
 */
export function aggregateLastNOccurrences(
	sessions: readonly SessionSummary[],
	bigram: string,
	window: number = BIGRAM_CLASSIFICATION_WINDOW
): RollingBigramAggregate | undefined {
	if (window < 1) throw new RangeError('window must be ≥ 1');
	const ordered = [...sessions].sort((a, b) => b.timestamp - a.timestamp);

	const pooled: BigramSample[] = [];
	for (const s of ordered) {
		const agg = s.bigramAggregates.find((a) => a.bigram === bigram);
		if (!agg || !agg.samples) continue;
		const remaining = window - pooled.length;
		if (remaining <= 0) break;
		// Take session tail so the window tracks recent attempts, not warm-up.
		const tail = agg.samples.slice(Math.max(0, agg.samples.length - remaining));
		pooled.push(...tail);
		if (pooled.length >= window) break;
	}

	if (pooled.length === 0) return undefined;

	const timings = pooled.map((s) => s.timing).filter((t): t is number => t !== null);
	const errorCount = pooled.reduce((n, s) => n + (s.correct ? 0 : 1), 0);
	return {
		occurrences: pooled.length,
		meanTime: timings.length === 0 ? NaN : timings.reduce((a, b) => a + b, 0) / timings.length,
		errorRate: errorCount / pooled.length
	};
}

/**
 * Aggregate all observed bigrams into table rows. Class/meanTime/errorRate
 * come from the rolling window (see `aggregateLastNOccurrences`) so a small
 * recent session can't mask a well-established bigram. `occurrences` is the
 * lifetime sum. Legacy data without samples falls back to the latest aggregate.
 */
export function summarizeBigrams(
	sessions: readonly SessionSummary[],
	corpus?: FrequencyTable,
	thresholds: ClassificationThresholds = DEFAULT_THRESHOLDS,
	window: number = BIGRAM_CLASSIFICATION_WINDOW
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
	for (const [bigram, latestAgg] of latest) {
		const rolling = aggregateLastNOccurrences(sessions, bigram, window);
		const classification = rolling ? classifyBigram(rolling, thresholds) : latestAgg.classification;
		const meanTime = rolling ? rolling.meanTime : latestAgg.meanTime;
		const errorRate = rolling ? rolling.errorRate : latestAgg.errorRate;

		const trend = buildBigramTrend(sessions, bigram);
		const badness = badness1D({ meanTime, errorRate }, thresholds);
		const freq = corpus?.[bigram] ?? 1;
		rows.push({
			bigram,
			classification,
			meanTime,
			errorRate,
			occurrences: occurrences.get(bigram) ?? latestAgg.occurrences,
			priorityScore: badness * freq,
			trend
		});
	}

	// Default sort: highest priority first. Components can re-sort as needed.
	rows.sort((a, b) => b.priorityScore - a.priorityScore);
	return rows;
}

/**
 * `PriorityBigram[]` built from the live rolling-window classification
 * (via `summarizeBigrams`) instead of a frozen diagnostic snapshot — so
 * drill target selection tracks current behaviour.
 *
 * Pass `classifications` to scope the top-N to a specific set of classes:
 * the priority score bakes in a 10× error weight, so hasty/acquisition
 * dominate a cross-class ranking and can starve fluency. Drill callers pass
 * the class(es) they want — accuracy gets `['hasty', 'acquisition']`, speed
 * gets `['fluency']`. Default: all non-healthy, non-unclassified.
 */
export function buildLivePriorityTargets(
	sessions: readonly SessionSummary[],
	corpus?: FrequencyTable,
	thresholds: ClassificationThresholds = DEFAULT_THRESHOLDS,
	limit: number = LIVE_PRIORITY_TARGETS_TOP_N,
	classifications?: readonly BigramClassification[]
): PriorityBigram[] {
	const rows = summarizeBigrams(sessions, corpus, thresholds);
	const allowed = classifications ? new Set<BigramClassification>(classifications) : undefined;
	const out: PriorityBigram[] = [];
	for (const r of rows) {
		if (r.classification === 'healthy' || r.classification === 'unclassified') continue;
		if (allowed && !allowed.has(r.classification)) continue;
		out.push({
			bigram: r.bigram,
			score: r.priorityScore,
			meanTime: r.meanTime,
			errorRate: r.errorRate,
			classification: r.classification
		});
		if (out.length >= limit) break;
	}
	return out;
}

/**
 * Corpus bigrams with lifetime occurrences below `minOccurrences`, sorted by
 * corpus frequency desc. Live counterpart to `corpusFit.undertrained` from the
 * diagnostic engine — reads session history, not a frozen snapshot.
 */
export function buildLiveUndertrained(
	sessions: readonly SessionSummary[],
	corpus: FrequencyTable | undefined,
	minOccurrences: number = MIN_OCCURRENCES_FOR_CLASSIFICATION
): string[] {
	if (!corpus) return [];
	const corpusKeys = Object.keys(corpus);
	if (corpusKeys.length === 0) return [];

	const observed = new Map<string, number>();
	for (const s of sessions) {
		for (const agg of s.bigramAggregates) {
			observed.set(agg.bigram, (observed.get(agg.bigram) ?? 0) + agg.occurrences);
		}
	}

	const under: { bigram: string; freq: number }[] = [];
	for (const key of corpusKeys) {
		if ((observed.get(key) ?? 0) < minOccurrences) {
			under.push({ bigram: key, freq: corpus[key] });
		}
	}
	under.sort((a, b) => b.freq - a.freq);
	return under.map((u) => u.bigram);
}

/**
 * Single-bigram badness scalar. Duplicated (narrowly) from `skill/engine`
 * because that copy is private and per-diagnostic — the analytics view wants
 * the same formula applied to any BigramAggregate. If these ever drift, the
 * table and the diagnostic priority list will stop agreeing.
 */
function badness1D(
	agg: Pick<BigramAggregate, 'meanTime' | 'errorRate'>,
	thresholds: ClassificationThresholds
): number {
	const slowRatio = Number.isFinite(agg.meanTime)
		? Math.max(0, agg.meanTime / thresholds.speedMs - 1)
		: 0;
	// Same 10× weight as diagnostic engine: 10% error ≈ 1.0 of badness.
	return slowRatio + agg.errorRate * 10;
}

/**
 * Bucketed counts across the four classified states. Shape-compatible with
 * `DiagnosticReport.counts` so the classification bar can take either a live
 * tally or a diagnostic snapshot.
 *
 * `unclassified` is surfaced separately because it isn't a point on the
 * acquisition→healthy ladder — it's "not enough data yet". Consumers decide
 * whether to show it (e.g. as supporting copy) rather than folding it into
 * the stacked bar and distorting the mix.
 */
export interface ClassificationMix {
	counts: {
		healthy: number;
		fluency: number;
		hasty: number;
		acquisition: number;
	};
	unclassified: number;
}

/**
 * Tally the live classification mix across all bigrams the user has data for.
 * Uses each row's current classification (sliding-window, thresholds already
 * applied by `summarizeBigrams`) — i.e. "where do I stand *right now*", not
 * "where did I stand at the last diagnostic".
 */
export function tallyClassificationMix(
	bigrams: readonly Pick<BigramSummary, 'classification'>[]
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
