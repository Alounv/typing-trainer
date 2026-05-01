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

/**
 * Aggregate all observed bigrams into rows. Class/meanTime/errorRate come from the rolling
 * window of the last `window` samples per bigram so a small recent session can't mask a
 * well-established bigram. `occurrences` is the lifetime sum. Legacy data without samples
 * falls back to the latest aggregate.
 *
 * Single pass with a bigram-keyed inverted index: each bigram walks only the sessions
 * it actually appears in (newest-first), instead of every session. Earlier versions
 * indexed session→bigram and walked all sessions per bigram, which was O(B × N) lookups
 * even when most bigrams appeared in only a handful of sessions.
 */
export function summarizeBigrams(
	sessions: readonly SessionSummary[],
	corpus: FrequencyTable | undefined,
	thresholds: ClassificationThresholds,
	window: number = BIGRAM_CLASSIFICATION_WINDOW
): BigramSummary[] {
	if (window < 1) throw new RangeError('window must be ≥ 1');

	// Walk newest-first so each bigram's per-session list is already in the order
	// the rolling-window pooler wants — we never sort the inner arrays.
	const orderedNewestFirst = [...sessions].sort((a, b) => b.timestamp - a.timestamp);

	// `latest` is the OLDEST agg seen during a newest-first walk (= the newest snapshot
	// in time, since we hit the newest session first). Set on first encounter only.
	const latest = new Map<string, BigramAggregate>();
	const occurrences = new Map<string, number>();
	const aggsByBigram = new Map<string, BigramAggregate[]>();
	for (const s of orderedNewestFirst) {
		for (const agg of s.bigramAggregates) {
			if (!latest.has(agg.bigram)) latest.set(agg.bigram, agg);
			occurrences.set(agg.bigram, (occurrences.get(agg.bigram) ?? 0) + agg.occurrences);
			let arr = aggsByBigram.get(agg.bigram);
			if (!arr) {
				arr = [];
				aggsByBigram.set(agg.bigram, arr);
			}
			arr.push(agg);
		}
	}

	// Off-corpus bigrams (stray paste, wrong language, exotic punctuation) fall back to the
	// corpus minimum so they don't outrank real targets. Without a corpus, everything gets 1.
	const fallbackFreq = corpus ? minPositive(corpus) : 1;

	const rows: BigramSummary[] = [];
	for (const [bigram, latestAgg] of latest) {
		const aggs = aggsByBigram.get(bigram);
		const pooled: BigramSample[] = [];
		if (aggs) {
			// aggs is newest-first by construction. Take session tails to the window cap.
			for (const agg of aggs) {
				if (!agg.samples || agg.samples.length === 0) continue;
				const remaining = window - pooled.length;
				if (remaining <= 0) break;
				const start = Math.max(0, agg.samples.length - remaining);
				for (let i = start; i < agg.samples.length; i++) pooled.push(agg.samples[i]);
				if (pooled.length >= window) break;
			}
		}

		let classification: BigramClassification;
		let meanTime: number;
		let errorRate: number;
		if (pooled.length > 0) {
			let timingSum = 0;
			let timingCount = 0;
			let errorCount = 0;
			for (const s of pooled) {
				if (s.timing !== null) {
					timingSum += s.timing;
					timingCount++;
				}
				if (!s.correct) errorCount++;
			}
			meanTime = timingCount === 0 ? NaN : timingSum / timingCount;
			errorRate = errorCount / pooled.length;
			classification = classifyBigram(
				{ occurrences: pooled.length, meanTime, errorRate },
				thresholds
			);
		} else {
			// Legacy path: pre-sample data has no rolling window to compute from.
			classification = latestAgg.classification;
			meanTime = latestAgg.meanTime;
			errorRate = latestAgg.errorRate;
		}

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
