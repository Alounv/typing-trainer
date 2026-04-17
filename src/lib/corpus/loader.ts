import type { CorpusConfig, CorpusData, FrequencyTable } from './types';

/** Zipf exponent for rank → frequency approximation. Real languages sit at 1.0–1.07. */
const ZIPF_EXPONENT = 1.0;

/**
 * Load a frequency-ordered wordlist (MonkeyType-style) plus a language-level
 * bigram frequency table into `CorpusData`. Word frequencies are Zipf-
 * approximated from rank (raw files carry order only). Bigram frequencies
 * come from a separate natural-language table — see `data/*-bigrams.json` —
 * because deriving them from a top-1k wordlist under-weights mid-rank pairs
 * and misses the rare-but-present ones entirely.
 */
export function loadCorpus(
	config: CorpusConfig,
	rawWordlist: string,
	bigramFrequencies: FrequencyTable = {}
): CorpusData {
	const words = tokenize(rawWordlist);
	const wordFrequencies = zipfFrequencies(words);
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
