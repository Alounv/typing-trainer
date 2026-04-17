import type { CorpusConfig, CorpusData, FrequencyTable } from './types';
import { deriveBigramFrequencies } from './loader';

/**
 * Minimum unique bigrams below which a custom corpus is flagged as
 * "too small for reliable diagnostics" (spec §6.3). 500 is the spec's
 * number; the threshold is the warn-boundary, not a hard reject —
 * callers decide whether to block or just surface a warning.
 */
export const MIN_CUSTOM_BIGRAMS = 500;

/** Result of importing a block of user text. */
export interface CustomCorpusImport {
	data: CorpusData;
	stats: {
		/** Count of tokens *after* tokenization (may be less than whitespace-split
		 * count if punctuation was stripped). */
		tokenCount: number;
		/** Unique words in the imported text. */
		uniqueWordCount: number;
		/** Unique bigrams — the metric that gates "too small" per spec §6.3. */
		uniqueBigramCount: number;
		/**
		 * True when `uniqueBigramCount < MIN_CUSTOM_BIGRAMS`. UI should show
		 * a warning rather than reject — some users deliberately drill
		 * narrow domains.
		 */
		tooSmall: boolean;
	};
	/**
	 * Bigrams the custom corpus *does not* contain that the caller-supplied
	 * base corpus *does*. Useful for overlap analysis (spec §6.3) — a
	 * custom corpus that misses many common bigrams is one to merge with
	 * base, not replace.
	 *
	 * `undefined` when no base corpus was passed.
	 */
	missingFromBase?: string[];
}

export interface ImportOptions {
	/** Id for the resulting `CorpusConfig`. Defaults to `'custom'`. */
	id?: string;
	/** Language label; `'custom'` when unknown. */
	language?: string;
	/** Optional base corpus used to compute missing-bigram overlap (spec §6.3). */
	baseForOverlap?: CorpusData;
}

/**
 * Build a `CorpusData` from user-supplied free text (spec §6.3).
 *
 * Tokenization picks "letters + internal apostrophes", lowercased. That's
 * deliberately narrow — we're deriving typing-practice frequencies, not
 * doing NLP. Numbers, punctuation, URLs, and code tokens are dropped;
 * counting them would skew the bigram table with symbols the user
 * probably doesn't want to drill by default.
 *
 * Word frequencies come out as raw counts (not Zipf-approximated) —
 * with actual text we have real counts, so we use them. Downstream
 * merges are scalar-scaled so mixing raw counts with Zipf-approximated
 * built-ins is fine.
 */
export function importCustomText(text: string, options: ImportOptions = {}): CustomCorpusImport {
	const tokens = tokenize(text);
	const wordFrequencies = countWords(tokens);
	const bigramFrequencies = deriveBigramFrequencies(wordFrequencies);

	const uniqueWordCount = Object.keys(wordFrequencies).length;
	const uniqueBigramCount = Object.keys(bigramFrequencies).length;

	const config: CorpusConfig = {
		id: options.id ?? 'custom',
		language: options.language ?? 'custom',
		wordlistId: options.id ?? 'custom',
		customText: text
	};

	const missingFromBase = options.baseForOverlap
		? diffBigrams(options.baseForOverlap.bigramFrequencies, bigramFrequencies)
		: undefined;

	return {
		data: { config, wordFrequencies, bigramFrequencies },
		stats: {
			tokenCount: tokens.length,
			uniqueWordCount,
			uniqueBigramCount,
			tooSmall: uniqueBigramCount < MIN_CUSTOM_BIGRAMS
		},
		missingFromBase
	};
}

/**
 * Extract letter-sequence tokens: Unicode letters plus in-word
 * apostrophes (so "d'abord" survives as one token, but "hello!" → "hello").
 * Lowercased for case-insensitive aggregation.
 *
 * `\p{L}` covers the full Unicode letter category — important for French
 * accented characters and any future language addition.
 */
function tokenize(text: string): string[] {
	const out: string[] = [];
	// Match letter sequences that may contain one-or-more internal apostrophes.
	const re = /\p{L}+(?:'\p{L}+)*/gu;
	for (const m of text.matchAll(re)) {
		out.push(m[0].toLowerCase());
	}
	return out;
}

/** Plain integer count per token. */
function countWords(tokens: readonly string[]): FrequencyTable {
	const out: FrequencyTable = {};
	for (const t of tokens) out[t] = (out[t] ?? 0) + 1;
	return out;
}

/**
 * Keys of `base` that don't appear in `compare`. Ordered by `base` frequency
 * descending so the first entries are the most-common-you're-missing.
 */
function diffBigrams(base: FrequencyTable, compare: FrequencyTable): string[] {
	const missing: { bigram: string; freq: number }[] = [];
	for (const bigram in base) {
		if (!(bigram in compare)) missing.push({ bigram, freq: base[bigram] });
	}
	return missing.sort((a, b) => b.freq - a.freq).map((e) => e.bigram);
}
