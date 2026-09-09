import type { FrequencyTable, Quote, QuoteBank } from './types';
import { addBoundaryBigrams } from './boundary-bigrams';
import { normalizeTypographicChars } from './normalize';

/**
 * Languages with shipped data. Each has a bigram frequency table (a property of
 * the language) and a quote bank (the material a passage is built from).
 *
 * Everything is behind a dynamic `import()` so Vite code-splits per language —
 * the quote banks are ~500 KB each and a user on English never downloads French.
 */
const LANGUAGES = ['en', 'fr'] as const;
type CorpusLanguage = (typeof LANGUAGES)[number];

export function hasCorpus(language: string): language is CorpusLanguage {
	return (LANGUAGES as readonly string[]).includes(language);
}

const BIGRAM_SOURCES: Record<
	CorpusLanguage,
	{ bigrams: () => Promise<{ default: unknown }>; wordlist: () => Promise<{ default: string }> }
> = {
	en: {
		bigrams: () => import('./data/english-bigrams.json'),
		wordlist: () => import('./data/english10k.txt?raw')
	},
	fr: {
		bigrams: () => import('./data/french-bigrams.json'),
		wordlist: () => import('./data/french10k.txt?raw')
	}
};

const QUOTE_SOURCES: Record<CorpusLanguage, () => Promise<{ default: unknown }>> = {
	en: () => import('./data/english-quotes.json'),
	fr: () => import('./data/french-quotes.json')
};

/**
 * Language-level bigram frequencies, used to weight how much a bigram is worth
 * training. Returns `undefined` rather than throwing: frequency weighting is a
 * refinement, and every consumer already has a sane unweighted fallback.
 *
 * The shipped JSON holds interior pairs only, so word-boundary pairs (`" t"`,
 * `"e "`) are derived from the wordlist — see `boundary-bigrams`.
 */
export async function loadBigramFrequencies(language: string): Promise<FrequencyTable | undefined> {
	if (!hasCorpus(language)) return undefined;
	try {
		const source = BIGRAM_SOURCES[language];
		const [interior, { default: wordlist }] = await Promise.all([
			source.bigrams(),
			source.wordlist()
		]);
		return addBoundaryBigrams(interior.default as FrequencyTable, wordlist);
	} catch {
		return undefined;
	}
}

/**
 * Load a language's quote bank. Rejects on an unknown language — callers gate
 * on {@link hasCorpus} first, and a missing bank means there is no prose to
 * type, which is not something to paper over.
 */
export async function loadQuoteBank(language: CorpusLanguage): Promise<QuoteBank> {
	// The JSON is author-controlled and its schema is stable, so a runtime
	// validator would be overkill for a build-time asset.
	const bank = (await QUOTE_SOURCES[language]()).default as QuoteBank;
	// Normalize each quote's text and recompute its length — `…` → `...`
	// changes the char count.
	const quotes: Quote[] = bank.quotes.map((q) => {
		const text = normalizeTypographicChars(q.text);
		return { ...q, text, length: text.length };
	});
	return { language: bank.language, quotes };
}
