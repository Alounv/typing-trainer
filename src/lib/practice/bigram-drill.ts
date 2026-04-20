import type { CorpusData } from '../corpus';

/**
 * Bigram drill sequence: target-bearing words (70%) interleaved with filler (30%).
 * Pure — no timing or pacing. Session runner handles those at drill-time.
 */

/** Default: 70% target-bearing, 30% filler. */
const DEFAULT_TARGET_RATIO = 0.7;
/** Default sequence length — enough for a 5-minute session at ~50–80 WPM. */
const DEFAULT_WORD_COUNT = 80;

export interface BigramDrillInput {
	/** Bigrams to drill. Caller has already ranked/filtered; empty array throws. */
	targetBigrams: readonly string[];
	corpus: CorpusData;
	options?: BigramDrillOptions;
}

export interface BigramDrillOptions {
	/** Total words to generate. Defaults to {@link DEFAULT_WORD_COUNT}. */
	wordCount?: number;
	/** Target-word ratio, default 0.7. Clamped to [0, 1] — tolerant of stray slider input. */
	targetRatio?: number;
	/** Injectable RNG for tests. Defaults to `Math.random`. */
	rng?: () => number;
}

export interface BigramDrillSequence {
	/** Flat space-joined string — feeds the typing surface directly. */
	text: string;
	/** Same content as `text`, split into individual words. */
	words: string[];
	/** Bucket counts for debug/sanity view ("30 target / 15 filler"). */
	stats: { targetWords: number; fillerWords: number; distinctTargets: number };
}

/**
 * Weight scheme: target words = `freq × distinct-targets-contained` (rewards words
 * stressing multiple targets). Filler = freq only — filler exists to keep
 * mechanical rhythm realistic, which 70/30 is designed to protect.
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

	// Narrow corpus / unusual targets → one pool may be empty. Fall back gracefully.
	if (targets.length === 0 && fillers.length === 0) {
		throw new Error('generateBigramDrillSequence: corpus produced no usable words');
	}

	const words: string[] = [];
	let targetWordCount = 0;
	let fillerWordCount = 0;
	const distinctTargets = new Set<string>();

	for (let i = 0; i < wordCount; i++) {
		const useTarget = (targets.length > 0 && rng() < ratio) || fillers.length === 0;
		const pool = useTarget ? targets : fillers;
		const picked = pickWeighted(pool, rng);
		words.push(picked);
		if (useTarget) {
			targetWordCount++;
			for (const t of input.targetBigrams) {
				if (wordMatchesTarget(picked, t)) distinctTargets.add(t);
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

// One-pass split into target-bearing / filler pools with weights baked in.
function partitionCorpus(
	corpus: CorpusData,
	targetBigrams: readonly string[]
): { targets: WeightedWord[]; fillers: WeightedWord[] } {
	const targets: WeightedWord[] = [];
	const fillers: WeightedWord[] = [];

	for (const word in corpus.wordFrequencies) {
		const freq = corpus.wordFrequencies[word];
		if (freq <= 0) continue;

		// Count distinct targets present, not occurrences — prevents runaway
		// weights ("the" with target "th" → ×1, not ×10).
		let hits = 0;
		for (const t of targetBigrams) {
			if (wordMatchesTarget(word, t)) hits++;
		}

		if (hits > 0) {
			targets.push({ word, weight: freq * hits });
		} else {
			fillers.push({ word, weight: freq });
		}
	}
	return { targets, fillers };
}

/**
 * True if placing `word` somewhere in the drill passage will produce the
 * `target` keystroke transition. Three shapes:
 *   - `"ab"` (letters only) — match if `word` contains `ab` internally.
 *   - `" a"` (leading space) — match if `word` starts with `a`, because typing
 *     the space before this word then its first letter produces the transition.
 *   - `"a "` (trailing space) — match if `word` ends with `a`, because typing
 *     its last letter then the space after it produces the transition.
 * Targets shorter than 2 chars and the `"  "` (two-space) case are no-ops —
 * they don't correspond to a single-word contribution.
 */
function wordMatchesTarget(word: string, target: string): boolean {
	if (target.length < 2) return false;
	const leadingSpace = target[0] === ' ';
	const trailingSpace = target[target.length - 1] === ' ';
	if (leadingSpace && trailingSpace) return false;
	if (leadingSpace) return word.startsWith(target.slice(1));
	if (trailingSpace) return word.endsWith(target.slice(0, -1));
	return word.includes(target);
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
