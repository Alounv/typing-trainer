import type { CorpusConfig, CorpusData, FrequencyTable } from './types';

/**
 * Multi-language corpus merging. Weights are proportions (default: equal split);
 * raw ratios like [7, 3] or [70, 30] are normalized to sum to 1. All-zero or
 * missing weights → equal split.
 */

interface MergeOptions {
	/** Parallel to `corpora`. Missing/mismatched → equal. Non-finite/negative → 0. */
	weights?: readonly number[];
	/** Id for merged config. Defaults to `merge:a+b+…`. */
	mergedId?: string;
}

/** Merge loaded corpora into one. Pure. Throws on empty input. */
export function mergeCorpora(
	corpora: readonly CorpusData[],
	options: MergeOptions = {}
): CorpusData {
	if (corpora.length === 0) throw new Error('mergeCorpora: no corpora provided');

	const weights = normalizeWeights(corpora.length, options.weights);

	const wordFrequencies: FrequencyTable = {};
	const bigramFrequencies: FrequencyTable = {};

	for (let i = 0; i < corpora.length; i++) {
		const w = weights[i];
		if (w === 0) continue;
		scaleInto(wordFrequencies, corpora[i].wordFrequencies, w);
		scaleInto(bigramFrequencies, corpora[i].bigramFrequencies, w);
	}

	const config = mergedConfig(corpora, options.mergedId);
	return { config, wordFrequencies, bigramFrequencies };
}

// Normalize weights to sum to 1. Non-finite/negative → 0. All-zero or shape-mismatched → equal.
function normalizeWeights(count: number, raw?: readonly number[]): number[] {
	if (!raw || raw.length !== count) {
		return Array.from({ length: count }, () => 1 / count);
	}

	const sanitized = raw.map((w) => (Number.isFinite(w) && w > 0 ? w : 0));
	const sum = sanitized.reduce((a, b) => a + b, 0);
	if (sum === 0) return Array.from({ length: count }, () => 1 / count);
	return sanitized.map((w) => w / sum);
}

// Fold `source` into `target` with scalar `factor`; target accumulates across calls.
function scaleInto(target: FrequencyTable, source: FrequencyTable, factor: number): void {
	for (const key in source) {
		target[key] = (target[key] ?? 0) + source[key] * factor;
	}
}

// `language` = hyphen-joined unique languages (first-appearance order). `wordlistId` = merged id.
function mergedConfig(corpora: readonly CorpusData[], mergedId?: string): CorpusConfig {
	const ids = corpora.map((c) => c.config.id);
	const id = mergedId ?? `merge:${ids.join('+')}`;
	const languages: string[] = [];
	for (const c of corpora) {
		if (!languages.includes(c.config.language)) languages.push(c.config.language);
	}
	return { id, language: languages.join('-'), wordlistId: id };
}
