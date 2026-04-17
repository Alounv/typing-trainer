import type { CorpusData } from './types';

/**
 * Real-text sentence selection (spec §4.2).
 *
 * Built-in corpora ship as ordered word lists, no prose. For Phase 4 we
 * synthesize "sentences" by weighted-random sampling from the corpus's
 * word frequencies — not literary, but enough to drive a real-text
 * session. When prose files are added later, this module grows a
 * secondary path that selects from pre-formed sentences and prefers
 * ones dense with target bigrams; for now, single code path.
 *
 * `targetBigrams` biases sampling toward words that contain any target
 * bigram. The boost is multiplicative on the word's base frequency so
 * non-target words still surface — we're biasing, not filtering.
 */

/** Default word count for a synthesized sentence (spec §4.2: min 8). */
const DEFAULT_WORD_COUNT = 12;

/** Multiplier applied to a word's base weight when it contains a target bigram. */
const TARGET_BOOST = 5;

export interface SelectionOptions {
	/** How many words in the synthesized sentence. Spec §4.2 requires ≥8. */
	wordCount?: number;
	/**
	 * Bigrams whose drill benefit we're chasing in this session. Words
	 * containing any of these get a frequency boost. Empty or undefined
	 * → no bias, pure frequency sampling.
	 */
	targetBigrams?: readonly string[];
	/**
	 * Injectable RNG so tests can pin sequences. Must return [0, 1).
	 * Defaults to `Math.random`.
	 */
	rng?: () => number;
}

/**
 * Pick N frequency-weighted words from the corpus, join with spaces,
 * return as a single string (a "sentence" in the walking sense of the
 * word — no punctuation, no capitalization).
 *
 * Throws on empty corpus — a silent empty-string return would mask a
 * real configuration bug.
 */
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

/**
 * Compute the per-word sampling weight, applying a {@link TARGET_BOOST}
 * multiplier for every target bigram the word contains. Boost stacks
 * when multiple targets hit the same word — a word with two target
 * bigrams is that much more attractive.
 *
 * Case-sensitive match: we assume the corpus and target bigrams are in
 * the same normalized form (all lowercase for built-in corpora).
 */
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

/**
 * Weighted-random pick: walk the cumulative weight, return the word
 * whose slice contains `r * total`. O(n) per pick — acceptable for the
 * ~1k-10k word counts we deal with and ~10-20 picks per sentence.
 */
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
	// Floating-point edge case: `rng()` returning exactly 1 (shouldn't,
	// but be defensive), or all weights being zero (caller should have
	// caught this upstream). Fall back to the last word.
	return words[words.length - 1];
}
