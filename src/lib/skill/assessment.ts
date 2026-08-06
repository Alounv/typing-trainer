import type {
	BigramAggregate,
	BigramClassification,
	BigramSample,
	ClassificationThresholds,
	PriorityBigram,
	SessionSummary
} from '../support/core';
import {
	BIGRAM_CLASSIFICATION_WINDOW,
	DEFAULT_THRESHOLDS,
	ERROR_TIME_BUDGET_MS,
	MIN_OCCURRENCES_FOR_CLASSIFICATION,
	PRIORITY_FREQUENCY_EXPONENT
} from '../support/core';
import type { FrequencyTable } from '../corpus';
import { classifyBigram, summarizeSamples } from './classification';

/** Priority target cap — mirrors the diagnostic engine's `PRIORITY_TARGETS_TOP_N`. */
const LIVE_PRIORITY_TARGETS_TOP_N = 10;

export interface BigramSummary {
	bigram: string;
	classification: BigramClassification;
	meanTime: number;
	errorRate: number;
	occurrences: number;
	/**
	 * Expected ms lost per occurrence, relative to the typist's own typical
	 * interval, with errors charged at {@link ERROR_TIME_BUDGET_MS}. A real
	 * quantity in real units — safe to display and to compare across bigrams.
	 */
	timeLossMs: number;
	/** Corpus frequency feeding the score; the corpus minimum for off-corpus pairs. */
	frequency: number;
	/**
	 * Default sort key: `timeLossMs × frequency^PRIORITY_FREQUENCY_EXPONENT`.
	 * A ranking heuristic, not a physical quantity — the exponent deliberately
	 * breaks the millisecond unit. Show `timeLossMs` when a number needs meaning.
	 */
	priorityScore: number;
}

/**
 * Aggregate observed bigrams. Class/meanTime/errorRate come from the rolling window of
 * the last `window` samples so a small recent session can't mask a well-established
 * bigram; `occurrences` is the lifetime sum. Legacy data without samples falls back to
 * the latest aggregate.
 */
export function summarizeBigrams(
	sessions: readonly SessionSummary[],
	corpus: FrequencyTable | undefined,
	thresholds: ClassificationThresholds,
	window: number = BIGRAM_CLASSIFICATION_WINDOW
): BigramSummary[] {
	if (window < 1) throw new RangeError('window must be ≥ 1');

	// Newest-first so the inverted index ends up in pool order.
	const orderedNewestFirst = [...sessions].sort((a, b) => b.timestamp - a.timestamp);

	// First-seen wins → newest snapshot, since we walk newest-first.
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

	// Pass 1: pool the rolling window and classify. The baseline needed for time
	// loss is a property of the whole set, so scoring waits for pass 2.
	interface PooledBigram {
		bigram: string;
		latestAgg: BigramAggregate;
		pooled: BigramSample[];
		classification: BigramClassification;
		meanTime: number;
		errorRate: number;
	}
	const partials: PooledBigram[] = [];
	for (const [bigram, latestAgg] of latest) {
		const aggs = aggsByBigram.get(bigram);
		const pooled: BigramSample[] = [];
		if (aggs) {
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
			({ meanTime, errorRate } = summarizeSamples(pooled));
			classification = classifyBigram(
				{ occurrences: pooled.length, meanTime, errorRate },
				thresholds
			);
		} else {
			// Legacy data without samples — no rolling window to compute from.
			classification = latestAgg.classification;
			meanTime = latestAgg.meanTime;
			errorRate = latestAgg.errorRate;
		}

		partials.push({ bigram, latestAgg, pooled, classification, meanTime, errorRate });
	}

	const baselineMs = typicalInterval(partials.flatMap((p) => p.pooled));

	// Pass 2: price each bigram in milliseconds, then rank.
	const rows: BigramSummary[] = partials.map((p) => {
		const frequency = corpus?.[p.bigram] ?? fallbackFreq;
		const observed = p.pooled.length > 0 ? p.pooled.length : p.latestAgg.occurrences;
		const timeLossMs = timeLossPerOccurrence(
			p.pooled,
			p.errorRate,
			p.meanTime,
			baselineMs,
			observed
		);
		return {
			bigram: p.bigram,
			classification: p.classification,
			meanTime: p.meanTime,
			errorRate: p.errorRate,
			occurrences: occurrences.get(p.bigram) ?? p.latestAgg.occurrences,
			timeLossMs,
			frequency,
			priorityScore: timeLossMs * Math.pow(frequency, PRIORITY_FREQUENCY_EXPONENT)
		};
	});

	// Default sort: highest priority first. Consumers can re-sort.
	rows.sort((a, b) => b.priorityScore - a.priorityScore);
	return rows;
}

/**
 * The typist's own reference pace: the median of every pooled clean transition.
 * Median rather than mean so that reading pauses and hesitations — which sit in a
 * long right tail — don't inflate the bar that every bigram is measured against.
 * `NaN` when nothing was timed at all.
 */
function typicalInterval(samples: readonly BigramSample[]): number {
	const timings: number[] = [];
	for (const s of samples) {
		if (s.timing !== null && Number.isFinite(s.timing)) timings.push(s.timing);
	}
	if (timings.length === 0) return NaN;
	timings.sort((a, b) => a - b);
	const mid = timings.length >> 1;
	return timings.length % 2 === 1 ? timings[mid] : (timings[mid - 1] + timings[mid]) / 2;
}

/**
 * Expected ms lost on one occurrence, as a mixture over the two cases an
 * occurrence can fall into:
 *
 *   loss = (1 − errorRate) × E[excess | timed] + errorRate × ERROR_TIME_BUDGET_MS
 *
 * The first term averages the excess **per sample** rather than taking the excess
 * of the average, and the difference is not cosmetic: a bigram typed quickly most
 * of the time but occasionally very slowly has a mean *below* baseline, so
 * `max(0, mean − baseline)` scores it zero while it is still losing real time on
 * its tail. Averaging first discards exactly the occurrences worth training.
 *
 * (`errorRate` counts incorrect samples while the average runs over timed ones,
 * and those sets differ slightly — a correct keystroke following a wrong one is
 * left untimed. The mixture treats them as complementary, which is close enough
 * for a ranking.)
 *
 * The result is then shrunk toward zero by `n / (n + MIN_OCCURRENCES)`. Without it
 * a bigram seen twice, once catastrophically, outranks a genuinely bad bigram seen
 * fifty times — and since the accuracy drill deliberately asks for `unclassified`
 * targets, those noise spikes would become real drills. Shrinkage scales every
 * well-observed bigram by roughly the same factor, so it demotes the
 * under-observed without reordering the rest.
 */
function timeLossPerOccurrence(
	pooled: readonly BigramSample[],
	errorRate: number,
	meanTime: number,
	baselineMs: number,
	observed: number
): number {
	const confidence = observed / (observed + MIN_OCCURRENCES_FOR_CLASSIFICATION);
	const errorCost = errorRate * ERROR_TIME_BUDGET_MS;
	if (!Number.isFinite(baselineMs)) return errorCost * confidence;

	let excessSum = 0;
	let timed = 0;
	for (const s of pooled) {
		if (s.timing === null || !Number.isFinite(s.timing)) continue;
		excessSum += Math.max(0, s.timing - baselineMs);
		timed++;
	}

	// Legacy aggregates carry no samples, so the per-occurrence excess degrades to
	// the excess of the stored mean — the very approximation described above.
	const cleanExcess =
		timed > 0
			? excessSum / timed
			: Number.isFinite(meanTime)
				? Math.max(0, meanTime - baselineMs)
				: 0;

	return ((1 - errorRate) * cleanExcess + errorCost) * confidence;
}

/**
 * `PriorityBigram[]` built from the live rolling-window classification. Drill target
 * selection uses this instead of a frozen diagnostic snapshot.
 *
 * Pass `classifications` to scope the top-N: a cross-class ranking lets one failure
 * mode crowd out the other, so each drill mode asks for the classes it treats.
 * Accuracy callers pass `['hasty', 'acquisition', 'unclassified']` (under-observed
 * bigrams that already look error-prone are worth drilling); speed callers pass
 * `['fluency']`.
 *
 * Healthy bigrams are excluded here rather than zeroed in `summarizeBigrams` —
 * `priorityScore` is now a measured cost, and forcing it to 0 would hide real time
 * loss from the analytics table. Note the consequence: a bigram that is usually
 * fast but occasionally slow still classifies as `healthy`, so it surfaces in the
 * table yet is never drilled. Closing that gap needs the classifier to look at the
 * spread, not just the mean.
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
