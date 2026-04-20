import type {
	BigramAggregate,
	BigramClassification,
	DiagnosticReport,
	PriorityBigram
} from '../core';
import {
	DEFAULT_THRESHOLDS,
	MIN_OCCURRENCES_FOR_CLASSIFICATION,
	type ClassificationThresholds
} from '../bigram';
import type { KeystrokeEvent } from '../typing';
import type { FrequencyTable } from '../corpus';
import { computeTargetWPM, deriveBaselineWPM } from './pacing';

/** Input bundle for {@link generateDiagnosticReport}. `corpusBigramFrequencies` undefined → stub `corpusFit` (coverageRatio 0). */
interface DiagnosticReportInput {
	sessionId: string;
	timestamp: number;
	events: readonly KeystrokeEvent[];
	aggregates: readonly BigramAggregate[];
	corpusBigramFrequencies?: FrequencyTable;
	thresholds?: ClassificationThresholds;
}

/** Top-N per-class "bottlenecks" shown in the report. */
const BOTTLENECKS_TOP_N = 5;
/** Total priority targets surfaced in the report. */
const PRIORITY_TARGETS_TOP_N = 10;

/** Error weight vs. slowness in badness scoring: 10% errors ≈ 100% over-threshold slowdown. */
const ERROR_PENALTY = 10;

/** Generate a structured diagnostic report. Pure: timestamp injected by caller. */
export function generateDiagnosticReport(input: DiagnosticReportInput): DiagnosticReport {
	const thresholds = input.thresholds ?? DEFAULT_THRESHOLDS;

	const baselineWPM = deriveBaselineWPM(input.events);
	const targetWPM = computeTargetWPM(baselineWPM);

	const counts = countByClassification(input.aggregates);
	const topBottlenecks = buildBottlenecks(input.aggregates);
	const priorityTargets = buildPriorityTargets(
		input.aggregates,
		thresholds,
		input.corpusBigramFrequencies
	);
	const corpusFit = buildCorpusFit(input.aggregates, input.corpusBigramFrequencies);

	return {
		sessionId: input.sessionId,
		timestamp: input.timestamp,
		baselineWPM,
		targetWPM,
		counts,
		topBottlenecks,
		priorityTargets,
		corpusFit
	};
}

// `unclassified` → undertrained (reported via corpus fit, not here).
function countByClassification(aggregates: readonly BigramAggregate[]): DiagnosticReport['counts'] {
	const counts = { healthy: 0, fluency: 0, hasty: 0, acquisition: 0 };
	for (const a of aggregates) {
		if (a.classification === 'unclassified') continue;
		counts[a.classification]++;
	}
	return counts;
}

// Top-N per non-healthy class, ranked by class-specific badness: fluency→meanTime,
// hasty→errors, acquisition→combined (the signal that matters for each class).
function buildBottlenecks(
	aggregates: readonly BigramAggregate[]
): DiagnosticReport['topBottlenecks'] {
	const byClass = groupByClass(aggregates);

	const fluency = [...byClass.fluency]
		.sort((a, b) => b.meanTime - a.meanTime)
		.slice(0, BOTTLENECKS_TOP_N)
		.map((a) => a.bigram);

	const hasty = [...byClass.hasty]
		.sort((a, b) => b.errorRate - a.errorRate)
		.slice(0, BOTTLENECKS_TOP_N)
		.map((a) => a.bigram);

	const acquisition = [...byClass.acquisition]
		.sort((a, b) => badnessScore(b, DEFAULT_THRESHOLDS) - badnessScore(a, DEFAULT_THRESHOLDS))
		.slice(0, BOTTLENECKS_TOP_N)
		.map((a) => a.bigram);

	return { fluency, hasty, acquisition };
}

/**
 * Priority list: non-healthy bigrams ranked by `badness × corpusFreq`.
 * If no corpus is supplied, falls back to raw badness — still ordered
 * meaningfully, just doesn't bias toward common bigrams.
 */
function buildPriorityTargets(
	aggregates: readonly BigramAggregate[],
	thresholds: ClassificationThresholds,
	corpus?: FrequencyTable
): PriorityBigram[] {
	const scored: PriorityBigram[] = [];
	for (const a of aggregates) {
		if (a.classification === 'healthy' || a.classification === 'unclassified') continue;
		const badness = badnessScore(a, thresholds);
		const freq = corpus?.[a.bigram] ?? 1;
		scored.push({
			bigram: a.bigram,
			score: badness * freq,
			meanTime: a.meanTime,
			errorRate: a.errorRate,
			classification: a.classification
		});
	}
	scored.sort((a, b) => b.score - a.score);
	return scored.slice(0, PRIORITY_TARGETS_TOP_N);
}

/**
 * Unified badness: `max(0, meanTime/speedMs - 1) + errorRate × ERROR_PENALTY`.
 * 10% error ≈ 2× slowdown (trade-off pinned by tests). Non-finite meanTime → error alone decides.
 */
function badnessScore(a: BigramAggregate, thresholds: ClassificationThresholds): number {
	const slowRatio = Number.isFinite(a.meanTime)
		? Math.max(0, a.meanTime / thresholds.speedMs - 1)
		: 0;
	return slowRatio + a.errorRate * ERROR_PENALTY;
}

/**
 * Coverage: fraction of corpus bigrams observed ≥ threshold. Undertrained sorted by corpus frequency desc.
 * No corpus → stub `{ coverageRatio: 0, undertrained: [] }`; UI treats this as "not available".
 */
function buildCorpusFit(
	aggregates: readonly BigramAggregate[],
	corpus?: FrequencyTable
): DiagnosticReport['corpusFit'] {
	if (!corpus) return { coverageRatio: 0, undertrained: [] };

	const observed = new Map<string, number>();
	for (const a of aggregates) observed.set(a.bigram, a.occurrences);

	const corpusKeys = Object.keys(corpus);
	if (corpusKeys.length === 0) return { coverageRatio: 0, undertrained: [] };

	let covered = 0;
	const under: { bigram: string; freq: number }[] = [];
	for (const key of corpusKeys) {
		const obs = observed.get(key) ?? 0;
		if (obs >= MIN_OCCURRENCES_FOR_CLASSIFICATION) {
			covered++;
		} else {
			under.push({ bigram: key, freq: corpus[key] });
		}
	}

	return {
		coverageRatio: covered / corpusKeys.length,
		undertrained: under.sort((a, b) => b.freq - a.freq).map((u) => u.bigram)
	};
}

type Grouped = Record<Exclude<BigramClassification, 'unclassified'>, BigramAggregate[]>;

function groupByClass(aggregates: readonly BigramAggregate[]): Grouped {
	const groups: Grouped = { healthy: [], fluency: [], hasty: [], acquisition: [] };
	for (const a of aggregates) {
		if (a.classification === 'unclassified') continue;
		groups[a.classification].push(a);
	}
	return groups;
}
