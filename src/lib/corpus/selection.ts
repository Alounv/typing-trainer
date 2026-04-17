import type { CorpusData } from './types';

/**
 * Real-text sentence synthesis: weighted-random sampling from corpus word
 * frequencies. `targetBigrams` multiplies the base weight of words containing
 * them (biasing, not filtering — non-target words still surface).
 */

const DEFAULT_WORD_COUNT = 12;

/** Multiplier on a word's base weight when it contains a target bigram. */
const TARGET_BOOST = 5;

export interface SelectionOptions {
	/** How many words in the synthesized sentence. Minimum 8 enforced. */
	wordCount?: number;
	/** Words containing these bigrams get a frequency boost. Empty → no bias. */
	targetBigrams?: readonly string[];
	/** Injectable RNG returning [0, 1). Defaults to `Math.random`. */
	rng?: () => number;
}

/** Pick N frequency-weighted words, join with spaces. Throws on empty corpus. */
export function selectRealTextSentence(corpus: CorpusData, options: SelectionOptions = {}): string {
	const words = Object.keys(corpus.wordFrequencies);
	if (words.length === 0) throw new Error('selectRealTextSentence: corpus has no words');

	const wordCount = Math.max(8, options.wordCount ?? DEFAULT_WORD_COUNT);
	const rng = options.rng ?? Math.random;
	const targets = options.targetBigrams ?? [];

	const weights = weightsWithTargetBoost(words, corpus.wordFrequencies, targets);
	const totalWeight = weights.reduce((a, b) => a + b, 0);

	// Shouldn't happen with positive frequencies, but defensive.
	if (totalWeight <= 0) throw new Error('selectRealTextSentence: total weight is zero');

	const picked: string[] = [];
	for (let i = 0; i < wordCount; i++) {
		picked.push(pickWeighted(words, weights, totalWeight, rng));
	}
	return picked.join(' ');
}

// Per-word weight with stacking TARGET_BOOST per contained bigram.
// Case-sensitive — corpus and targets share normalized form (lowercase).
function weightsWithTargetBoost(
	words: readonly string[],
	freqs: Readonly<Record<string, number>>,
	targets: readonly string[]
): number[] {
	const out = new Array<number>(words.length);
	for (let i = 0; i < words.length; i++) {
		const word = words[i];
		let weight = freqs[word] ?? 0;
		if (targets.length > 0) {
			for (const t of targets) {
				if (t.length >= 2 && word.includes(t)) weight *= TARGET_BOOST;
			}
		}
		out[i] = weight;
	}
	return out;
}

// O(n) cumulative-weight walk — fine for ~1k-10k words × ~10-20 picks/sentence.
function pickWeighted(
	words: readonly string[],
	weights: readonly number[],
	total: number,
	rng: () => number
): string {
	const target = rng() * total;
	let running = 0;
	for (let i = 0; i < words.length; i++) {
		running += weights[i];
		if (target < running) return words[i];
	}
	// Float edge case (rng → exactly 1, or all-zero weights) — fall back to last word.
	return words[words.length - 1];
}
