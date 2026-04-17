import type { CorpusConfig, CorpusData, FrequencyTable } from './types';

/** Zipf exponent for rank → frequency approximation. Real languages sit at 1.0–1.07. */
const ZIPF_EXPONENT = 1.0;

/**
 * Load a frequency-ordered wordlist (MonkeyType-style) into `CorpusData`. Word
 * frequencies are Zipf-approximated from rank (raw files carry order only).
 * Bigrams are derived per-word; inter-word pairs are skipped — they're text-
 * formation dependent and picked up later by real-text selection.
 */
export function loadCorpus(config: CorpusConfig, rawWordlist: string): CorpusData {
	const words = tokenize(rawWordlist);
	const wordFrequencies = zipfFrequencies(words);
	const bigramFrequencies = deriveBigramFrequencies(wordFrequencies);
	return { config, wordFrequencies, bigramFrequencies };
}

// Whitespace split for pre-normalized flat lists. Custom-text imports use a smarter tokenizer.
function tokenize(raw: string): string[] {
	return raw.split(/\s+/).filter((w) => w.length > 0);
}

// Assign `1 / rank^ZIPF_EXPONENT` per word. Duplicates collapse to the first occurrence's rank.
function zipfFrequencies(orderedWords: string[]): FrequencyTable {
	const out: FrequencyTable = {};
	// Rank is tracked separately from index so duplicates don't consume a rank slot.
	let rank = 1;
	for (const w of orderedWords) {
		if (out[w] !== undefined) continue;
		out[w] = 1 / Math.pow(rank, ZIPF_EXPONENT);
		rank++;
	}
	return out;
}

/**
 * Derive bigram frequencies from a word table. Each adjacent char pair in a word
 * contributes the word's frequency. Chars pass through verbatim (apostrophes,
 * accents) — "d'abord" yields `d'`, `'a`, `ab`, …
 */
export function deriveBigramFrequencies(words: FrequencyTable): FrequencyTable {
	const out: FrequencyTable = {};
	for (const word in words) {
		const freq = words[word];
		if (word.length < 2) continue;
		for (let i = 0; i < word.length - 1; i++) {
			const bigram = word.substring(i, i + 2);
			out[bigram] = (out[bigram] ?? 0) + freq;
		}
	}
	return out;
}
