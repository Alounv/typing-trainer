import type { CorpusData } from '../corpus/types';

/**
 * Bigram drill sequence generation (spec §4.1).
 *
 * Given a set of target bigrams and a loaded corpus, emits an ordered
 * list of real words interleaving target-bearing words (70%) with
 * filler words from the rest of the corpus (30%). The ratio comes from
 * the spec; the function accepts an override for tuning.
 *
 * This module is pure — no timing, no UI, no pacing. The session runner
 * consumes the generated sequence and applies per-classification pacing
 * at drill-time.
 */

/** Spec §4.1 default: 70% target-bearing, 30% filler. */
const DEFAULT_TARGET_RATIO = 0.7;
/** Default sequence length — enough for a 5-minute session at ~50–80 WPM. */
const DEFAULT_WORD_COUNT = 80;

export interface BigramDrillInput {
	/**
	 * Ranked list of bigrams the user should drill (spec §4.1). Ranking
	 * itself isn't used directly here — the caller is responsible for
	 * choosing which targets to pass. Passing an empty array is an error:
	 * without targets there's no drill to generate.
	 */
	targetBigrams: readonly string[];
	corpus: CorpusData;
	options?: BigramDrillOptions;
}

export interface BigramDrillOptions {
	/** Total words to generate. Defaults to {@link DEFAULT_WORD_COUNT}. */
	wordCount?: number;
	/**
	 * Target-word ratio. Default 0.7 per spec. Accepts [0, 1]; values
	 * outside that range are clamped rather than throwing — callers
	 * shouldn't crash on a stray slider input.
	 */
	targetRatio?: number;
	/** Injectable RNG for tests. Defaults to `Math.random`. */
	rng?: () => number;
}

export interface BigramDrillSequence {
	/** Flat space-joined string — feeds the typing surface directly. */
	text: string;
	/** Same content as `text`, split into individual words. */
	words: string[];
	/**
	 * How many words ended up in each bucket. Useful for sanity checks
	 * and for UI to report "30 target words / 15 filler" in a debug view.
	 */
	stats: { targetWords: number; fillerWords: number; distinctTargets: number };
}

/**
 * Generate a bigram drill sequence.
 *
 * Weight scheme:
 * - **Target-word** pool: word frequency × count of target bigrams the word
 *   contains. So "thing" contributes to pool with weight `freq × 2` if both
 *   "th" and "ng" are targets. That rewards words that stress multiple
 *   targets at once, which is the whole point of the drill.
 * - **Filler-word** pool: word frequency only. Filler exists to keep the
 *   mechanical rhythm realistic (pure target-word drills feel drilling-like,
 *   which is the anti-pattern the 70/30 ratio is designed to break).
 */
export function generateBigramDrillSequence(input: BigramDrillInput): BigramDrillSequence {
	if (input.targetBigrams.length === 0) {
		throw new Error('generateBigramDrillSequence: targetBigrams is empty');
	}
	const options = input.options ?? {};
	const wordCount = options.wordCount ?? DEFAULT_WORD_COUNT;
	const ratio = clamp(options.targetRatio ?? DEFAULT_TARGET_RATIO, 0, 1);
	const rng = options.rng ?? Math.random;

	const { targets, fillers } = partitionCorpus(input.corpus, input.targetBigrams);

	// Edge: a very narrow corpus + broad targets could leave filler empty,
	// or unusual targets could leave target pool empty. Fall back gracefully
	// so the caller still gets a usable sequence.
	if (targets.length === 0 && fillers.length === 0) {
		throw new Error('generateBigramDrillSequence: corpus produced no usable words');
	}

	const words: string[] = [];
	let targetWordCount = 0;
	let fillerWordCount = 0;
	const distinctTargets = new Set<string>();

	for (let i = 0; i < wordCount; i++) {
		const useTarget =
			(targets.length > 0 && rng() < ratio) || fillers.length === 0;
		const pool = useTarget ? targets : fillers;
		const picked = pickWeighted(pool, rng);
		words.push(picked);
		if (useTarget) {
			targetWordCount++;
			for (const t of input.targetBigrams) {
				if (t.length >= 2 && picked.includes(t)) distinctTargets.add(t);
			}
		} else {
			fillerWordCount++;
		}
	}

	return {
		text: words.join(' '),
		words,
		stats: {
			targetWords: targetWordCount,
			fillerWords: fillerWordCount,
			distinctTargets: distinctTargets.size
		}
	};
}

interface WeightedWord {
	word: string;
	weight: number;
}

/**
 * Walk the corpus's word frequency table once, splitting each word into
 * the target-bearing or filler pool. Weights are baked in so the sampler
 * doesn't have to re-check bigram membership on every pick.
 */
function partitionCorpus(
	corpus: CorpusData,
	targetBigrams: readonly string[]
): { targets: WeightedWord[]; fillers: WeightedWord[] } {
	const targets: WeightedWord[] = [];
	const fillers: WeightedWord[] = [];

	for (const word in corpus.wordFrequencies) {
		const freq = corpus.wordFrequencies[word];
		if (freq <= 0) continue;

		// Count distinct target bigrams present in this word. We count per
		// target (not per occurrence) so a word with lots of the same bigram
		// doesn't run away — "the" with target "th" gets weight × 1, not × 10.
		let hits = 0;
		for (const t of targetBigrams) {
			if (t.length >= 2 && word.includes(t)) hits++;
		}

		if (hits > 0) {
			targets.push({ word, weight: freq * hits });
		} else {
			fillers.push({ word, weight: freq });
		}
	}
	return { targets, fillers };
}

/** Weighted pick from a `WeightedWord[]`. O(n) — fine for ≤10k-word pools. */
function pickWeighted(pool: readonly WeightedWord[], rng: () => number): string {
	let total = 0;
	for (const w of pool) total += w.weight;
	if (total <= 0) return pool[0].word;

	const target = rng() * total;
	let running = 0;
	for (const w of pool) {
		running += w.weight;
		if (target < running) return w.word;
	}
	return pool[pool.length - 1].word;
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}
