import type { CorpusConfig, CorpusData, FrequencyTable } from './types';

/** Zipf exponent for rank → frequency approximation. Real languages sit at 1.0–1.07. */
const ZIPF_EXPONENT = 1.0;

/** Loads a rank-ordered wordlist (Zipf-approximated) + separate bigram table. Bigrams are separate because a top-1k wordlist under-weights mid-rank pairs and misses rare ones. */
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

function zipfFrequencies(orderedWords: string[]): FrequencyTable {
	const out: FrequencyTable = {};
	// Duplicates collapse to the first occurrence's rank — don't consume a slot.
	let rank = 1;
	for (const w of orderedWords) {
		if (out[w] !== undefined) continue;
		out[w] = 1 / Math.pow(rank, ZIPF_EXPONENT);
		rank++;
	}
	return out;
}
