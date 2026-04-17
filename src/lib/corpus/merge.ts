import type { CorpusConfig, CorpusData, FrequencyTable } from './types';

/**
 * Multi-language corpus merging (spec §6.2).
 *
 * Caller supplies an ordered list of loaded corpora and a matching set
 * of language-level weights expressed as _proportions_ (default: equal
 * split). The weights scale each corpus's contribution to the combined
 * frequency tables. A 70/30 French/English user lands here with
 * weights [0.7, 0.3] → French frequencies dominate by 2.33×.
 *
 * Weights are normalized defensively: if the caller passes raw ratios
 * like [7, 3] or [70, 30], we rescale to sum to 1. An all-zero or empty
 * weights array falls back to equal weight.
 */

export interface MergeOptions {
	/**
	 * Parallel to `corpora`. If omitted or length-mismatched, every
	 * corpus gets equal weight. Non-finite or negative entries are
	 * treated as 0.
	 */
	weights?: readonly number[];
	/** Id for the merged `CorpusConfig.id`. Defaults to a hash-ish join. */
	mergedId?: string;
}

/**
 * Merge an ordered list of loaded corpora into one. Pure.
 *
 * Empty input throws — there's no meaningful "empty corpus" to return,
 * and silent zero-word corpora downstream would mask configuration bugs.
 * Single-corpus input is allowed and trivially returns that corpus
 * (re-wrapped with the merged id), useful when the caller doesn't know
 * in advance whether the user picked one language or many.
 */
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

/**
 * Normalize a weights array to sum to 1. Non-finite / negative entries
 * → 0. All-zero or length-mismatched → equal weights.
 */
function normalizeWeights(count: number, raw?: readonly number[]): number[] {
	// Equal split when not supplied or shape-mismatched.
	if (!raw || raw.length !== count) {
		return Array.from({ length: count }, () => 1 / count);
	}

	const sanitized = raw.map((w) => (Number.isFinite(w) && w > 0 ? w : 0));
	const sum = sanitized.reduce((a, b) => a + b, 0);
	if (sum === 0) return Array.from({ length: count }, () => 1 / count);
	return sanitized.map((w) => w / sum);
}

/**
 * Fold `source` into `target` with scalar `factor`. Target accumulates
 * across calls so the caller can merge any number of tables.
 */
function scaleInto(target: FrequencyTable, source: FrequencyTable, factor: number): void {
	for (const key in source) {
		target[key] = (target[key] ?? 0) + source[key] * factor;
	}
}

/**
 * Stitch a sensible `CorpusConfig` for the merged result. `language`
 * becomes a hyphenated list of participating languages (unique, ordered
 * by first appearance). `wordlistId` mirrors the merged id.
 */
function mergedConfig(corpora: readonly CorpusData[], mergedId?: string): CorpusConfig {
	const ids = corpora.map((c) => c.config.id);
	const id = mergedId ?? `merge:${ids.join('+')}`;
	const languages: string[] = [];
	for (const c of corpora) {
		if (!languages.includes(c.config.language)) languages.push(c.config.language);
	}
	return { id, language: languages.join('-'), wordlistId: id };
}
