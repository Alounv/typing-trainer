import type { CorpusConfig, CorpusData, FrequencyTable } from './types';

/**
 * Zipf exponent for rank → frequency approximation. 1.0 is the classical
 * Zipf prediction; real-language data typically sits around 1.0–1.07,
 * close enough that we use the clean 1.0 and move on. If the corpus
 * data ever ships with explicit counts (e.g. derived from a larger
 * reference corpus), swap to those and delete this constant.
 */
const ZIPF_EXPONENT = 1.0;

/**
 * Turn a frequency-ordered, space-separated wordlist string (the shape
 * MonkeyType-style corpus files ship) into a fully populated
 * {@link CorpusData}.
 *
 * `freqs` are Zipf-approximated from rank — the raw files carry no
 * count information, just order. That's fine for our use case: everything
 * that consumes a corpus (drill-word selection, priority scoring,
 * coverage) wants *relative* frequencies, not absolute counts. Zipf
 * gives a defensible ranking curve (`freq ∝ 1 / rank`) so #1 is ~2×
 * #2, ~10× #10, etc., which matches real-language behavior closely
 * enough that no caller will notice.
 *
 * Bigrams are derived from the word list, each word weighted by its
 * own word-frequency. A word contributes a bigram for each adjacent
 * letter pair; spaces between words are NOT injected — those pairs
 * ("word ending" → "word start") are formation-agnostic (they depend
 * on which words happen to sit together in a given rendered text), so
 * we let the real-text selection phase pick them up if it wants.
 */
export function loadCorpus(config: CorpusConfig, rawWordlist: string): CorpusData {
	const words = tokenize(rawWordlist);
	const wordFrequencies = zipfFrequencies(words);
	const bigramFrequencies = deriveBigramFrequencies(wordFrequencies);
	return { config, wordFrequencies, bigramFrequencies };
}

/**
 * Split on any whitespace and drop empties. Not locale-aware because
 * the data files are a flat list — no punctuation, already normalized.
 * For custom-text imports (spec §6.3) we need something smarter, which
 * lives in `custom.ts`.
 */
function tokenize(raw: string): string[] {
	return raw.split(/\s+/).filter((w) => w.length > 0);
}

/**
 * Assign `1 / rank^ZIPF_EXPONENT` to each ordered word. Duplicates in
 * the input (shouldn't happen in the canonical lists, but defensive)
 * collapse — the first occurrence's rank wins, later duplicates are
 * dropped. Returns a plain Record; order is not preserved, but callers
 * that need order should use the original tokenized array.
 */
function zipfFrequencies(orderedWords: string[]): FrequencyTable {
	const out: FrequencyTable = {};
	// Track the rank we've assigned so far separately from array index:
	// if a duplicate appears, we skip it without consuming a rank slot.
	// Otherwise the rank of the 3rd *unique* word depends on how many
	// duplicates sat before it, which isn't what callers want.
	let rank = 1;
	for (const w of orderedWords) {
		if (out[w] !== undefined) continue;
		out[w] = 1 / Math.pow(rank, ZIPF_EXPONENT);
		rank++;
	}
	return out;
}

/**
 * Derive bigram frequencies from a word-frequency table.
 *
 * For each word of length ≥2, each adjacent character pair contributes
 * the word's frequency to that bigram. This gives weighted counts that
 * reflect both how common a word is and how often a given pair appears
 * within it. Apostrophes, accents, and whatever else the wordlist
 * contains are passed through verbatim — if "d'abord" is in the French
 * list, it produces `d'`, `'a`, `ab`, …
 *
 * Visible for testing via the loader; direct use is unusual.
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
