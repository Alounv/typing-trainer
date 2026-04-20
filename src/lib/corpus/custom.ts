import type { CorpusConfig, CorpusData, FrequencyTable } from './types';
import { normalizeTypographicChars } from './normalize';

/** Warn boundary for "too small for reliable diagnostics" — not a hard reject. */
export const MIN_CUSTOM_BIGRAMS = 500;

/** Result of importing a block of user text. */
interface CustomCorpusImport {
	data: CorpusData;
	stats: {
		/** Tokens after tokenization; may differ from whitespace-split if punctuation was stripped. */
		tokenCount: number;
		uniqueWordCount: number;
		/** Unique bigrams — gates the "too small" warning. */
		uniqueBigramCount: number;
		/** UI should warn (not reject) — users may deliberately drill narrow domains. */
		tooSmall: boolean;
	};
	/**
	 * Bigrams in base but not custom. Informs merge-vs-replace decisions.
	 * `undefined` when no base corpus was passed.
	 */
	missingFromBase?: string[];
}

interface ImportOptions {
	/** Id for the resulting `CorpusConfig`. Defaults to `'custom'`. */
	id?: string;
	/** Language label; `'custom'` when unknown. */
	language?: string;
	/** Optional base corpus for missing-bigram overlap analysis. */
	baseForOverlap?: CorpusData;
}

/**
 * Build `CorpusData` from user text. Tokenizes letter-sequences + internal
 * apostrophes, lowercased (numbers/punctuation/URLs dropped — typing practice,
 * not NLP). Word frequencies are raw counts, not Zipf-approximated.
 */
export function importCustomText(text: string, options: ImportOptions = {}): CustomCorpusImport {
	// Flatten smart punctuation before tokenizing — the tokenizer treats only
	// ASCII `'` as a word-internal separator, so a curly apostrophe in "d'abord"
	// would otherwise split the word into two tokens.
	const normalized = normalizeTypographicChars(text);
	const tokens = tokenize(normalized);
	const wordFrequencies = countWords(tokens);
	const bigramFrequencies = deriveBigramFrequencies(wordFrequencies);

	const uniqueWordCount = Object.keys(wordFrequencies).length;
	const uniqueBigramCount = Object.keys(bigramFrequencies).length;

	const config: CorpusConfig = {
		id: options.id ?? 'custom',
		language: options.language ?? 'custom',
		wordlistId: options.id ?? 'custom',
		customText: normalized
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

// Letter-sequence tokens + in-word apostrophes ("d'abord" stays one token, "hello!" → "hello").
// `\p{L}` covers the full Unicode letter category for accented and non-Latin scripts.
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
 * Bigram frequencies for custom text: each adjacent char pair inside a word
 * contributes the word's count. Built-in corpora use language-level tables
 * (`data/*-bigrams.json`) instead — custom text has no such table, so we
 * derive from the user's own tokens, which doubles as "this is the bigram
 * distribution the user is asking us to drill on."
 */
function deriveBigramFrequencies(words: FrequencyTable): FrequencyTable {
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

// Keys of `base` not in `compare`, ordered by `base` frequency desc.
function diffBigrams(base: FrequencyTable, compare: FrequencyTable): string[] {
	const missing: { bigram: string; freq: number }[] = [];
	for (const bigram in base) {
		if (!(bigram in compare)) missing.push({ bigram, freq: base[bigram] });
	}
	return missing.sort((a, b) => b.freq - a.freq).map((e) => e.bigram);
}
