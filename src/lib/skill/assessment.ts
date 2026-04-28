import type {
	BigramAggregate,
	BigramClassification,
	BigramSample,
	ClassificationThresholds,
	PriorityBigram,
	SessionSummary
} from '../support/core';
import { DEFAULT_THRESHOLDS, MIN_OCCURRENCES_FOR_CLASSIFICATION } from '../support/core';
import type { FrequencyTable } from '../corpus';
import { classifyBigram } from './classification';

/** Pooled-samples window for per-bigram classification. Resists single-session outliers
 *  while tracking recent behavior. */
const BIGRAM_CLASSIFICATION_WINDOW = 10;

/** Priority target cap — mirrors the diagnostic engine's `PRIORITY_TARGETS_TOP_N`. */
const LIVE_PRIORITY_TARGETS_TOP_N = 10;

export interface BigramSummary {
	bigram: string;
	classification: BigramClassification;
	meanTime: number;
	errorRate: number;
	occurrences: number;
	/** Product of `badness × corpus frequency`. Default sort key. */
	priorityScore: number;
}

interface RollingBigramAggregate {
	occurrences: number;
	meanTime: number;
	errorRate: number;
}

/**
 * Pool the last `window` per-occurrence samples for `bigram`. Caller pre-sorts sessions
 * newest-first and pre-builds the `bigramIndex` so we don't redo that O(n log n + m)
 * setup per bigram in a hot loop.
 */
function aggregateLastNOccurrences(
	orderedNewestFirst: readonly SessionSummary[],
	bigramIndex: ReadonlyMap<string, ReadonlyMap<string, BigramAggregate>>,
	bigram: string,
	window: number
): RollingBigramAggregate | undefined {
	const pooled: BigramSample[] = [];
	for (const s of orderedNewestFirst) {
		const agg = bigramIndex.get(s.id)?.get(bigram);
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
 * Per-session map from bigram → aggregate, so the rolling-window pooler can do an
 * O(1) lookup instead of an O(per-session-bigrams) scan on every (bigram, session) pair.
 */
function indexBigramAggregates(
	sessions: readonly SessionSummary[]
): Map<string, Map<string, BigramAggregate>> {
	const out = new Map<string, Map<string, BigramAggregate>>();
	for (const s of sessions) {
		const inner = new Map<string, BigramAggregate>();
		for (const agg of s.bigramAggregates) inner.set(agg.bigram, agg);
		out.set(s.id, inner);
	}
	return out;
}

/**
 * Aggregate all observed bigrams into rows. Class/meanTime/errorRate come from the rolling
 * window (see `aggregateLastNOccurrences`) so a small recent session can't mask a
 * well-established bigram. `occurrences` is the lifetime sum. Legacy data without samples
 * falls back to the latest aggregate.
 */
export function summarizeBigrams(
	sessions: readonly SessionSummary[],
	corpus?: FrequencyTable,
	thresholds: ClassificationThresholds = DEFAULT_THRESHOLDS,
	window: number = BIGRAM_CLASSIFICATION_WINDOW
): BigramSummary[] {
	if (window < 1) throw new RangeError('window must be ≥ 1');

	// Sessions oldest-first so the final pass overwrites with the newest snapshot.
	const ordered = [...sessions].sort((a, b) => a.timestamp - b.timestamp);
	// Newest-first ordering used by the rolling-window pooler — hoisted so we sort once.
	const orderedNewestFirst = [...ordered].reverse();
	const bigramIndex = indexBigramAggregates(sessions);

	const latest = new Map<string, BigramAggregate>();
	const occurrences = new Map<string, number>();
	for (const s of ordered) {
		for (const agg of s.bigramAggregates) {
			latest.set(agg.bigram, agg);
			occurrences.set(agg.bigram, (occurrences.get(agg.bigram) ?? 0) + agg.occurrences);
		}
	}

	// Off-corpus bigrams (stray paste, wrong language, exotic punctuation) fall back to the
	// corpus minimum so they don't outrank real targets. Without a corpus, everything gets 1.
	const fallbackFreq = corpus ? minPositive(corpus) : 1;

	const rows: BigramSummary[] = [];
	for (const [bigram, latestAgg] of latest) {
		const rolling = aggregateLastNOccurrences(orderedNewestFirst, bigramIndex, bigram, window);
		const classification = rolling ? classifyBigram(rolling, thresholds) : latestAgg.classification;
		const meanTime = rolling ? rolling.meanTime : latestAgg.meanTime;
		const errorRate = rolling ? rolling.errorRate : latestAgg.errorRate;

		const badness = badness1D({ meanTime, errorRate }, thresholds);
		const freq = corpus?.[bigram] ?? fallbackFreq;
		rows.push({
			bigram,
			classification,
			meanTime,
			errorRate,
			occurrences: occurrences.get(bigram) ?? latestAgg.occurrences,
			priorityScore: classification === 'healthy' ? 0 : badness * freq * 1000
		});
	}

	// Default sort: highest priority first. Consumers can re-sort.
	rows.sort((a, b) => b.priorityScore - a.priorityScore);
	return rows;
}

/**
 * `PriorityBigram[]` built from the live rolling-window classification. Drill target
 * selection uses this instead of a frozen diagnostic snapshot.
 *
 * Pass `classifications` to scope the top-N: the score bakes in a 10× error weight, so
 * hasty/acquisition dominate a cross-class ranking and can starve fluency. Accuracy
 * callers pass `['hasty', 'acquisition', 'unclassified']` (under-observed bigrams that
 * already look error-prone are worth drilling); speed callers pass `['fluency']`.
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
		if (r.classification === 'healthy') continue;
		if (allowed) {
			if (!allowed.has(r.classification)) continue;
		} else if (r.classification === 'unclassified') {
			continue;
		}
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
 * Corpus bigrams with lifetime occurrences below `minOccurrences`, sorted by corpus
 * frequency desc. Live counterpart to `corpusFit.undertrained` from the diagnostic
 * engine — reads session history, not a frozen snapshot.
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

function minPositive(table: FrequencyTable): number {
	let min = Infinity;
	for (const v of Object.values(table)) {
		if (v > 0 && v < min) min = v;
	}
	return Number.isFinite(min) ? min : 1;
}

/** Single-bigram badness scalar. 10% error ≈ 1.0 of badness — same weight as diagnostic engine. */
function badness1D(
	agg: Pick<BigramAggregate, 'meanTime' | 'errorRate'>,
	thresholds: ClassificationThresholds
): number {
	const slowRatio = Number.isFinite(agg.meanTime)
		? Math.max(0, agg.meanTime / thresholds.speedMs - 1)
		: 0;
	return slowRatio + agg.errorRate * 10;
}
