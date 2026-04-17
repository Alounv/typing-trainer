import type { CorpusConfig, CorpusData, FrequencyTable, QuoteBank } from './types';
import { loadCorpus } from './loader';

/**
 * Languages with a shipped bigram frequency table. Kept separate from
 * `BUILTIN_CORPUS_IDS` because multiple corpora (top-1k, top-5k, top-10k)
 * share a single language-level table — the bigram distribution is a
 * property of the language, not the wordlist.
 */
export const BIGRAM_LANGUAGES = ['en', 'fr'] as const;
export type BigramLanguage = (typeof BIGRAM_LANGUAGES)[number];

const BIGRAM_LOADERS: Record<BigramLanguage, () => Promise<FrequencyTable>> = {
	en: async () => {
		const mod = await import('./data/english-bigrams.json');
		return mod.default as FrequencyTable;
	},
	fr: async () => {
		const mod = await import('./data/french-bigrams.json');
		return mod.default as FrequencyTable;
	}
};

/**
 * Canonical ids for built-in corpora. Exposed as a `const` tuple so
 * callers can type-check against them (e.g., "is this the id of a real
 * built-in, or a custom-corpus id I made up?").
 *
 * `fr-top-1500` is deliberately named after its actual size — the source
 * file is 1,500 words even though it's in `french1k.ts`.
 */
export const BUILTIN_CORPUS_IDS = [
	'en-top-1000',
	'en-top-5000',
	'en-top-10000',
	'fr-top-1500',
	'fr-top-10000'
] as const;
export type BuiltinCorpusId = (typeof BUILTIN_CORPUS_IDS)[number];

/**
 * Lazy loaders keyed by id. Each corpus file is ~5–90 KB of raw string
 * plus parsed frequencies — not huge, but there's no reason to ship
 * every language + size to every user up front. Dynamic `import()` lets
 * Vite split these into their own chunks so a user on English never
 * downloads French 10k.
 *
 * The callbacks return the fully computed `CorpusData` (via `loadCorpus`)
 * so consumers don't have to know about the raw-string layer below.
 */
// Load the wordlist and the language-level bigram table in parallel, then hand
// both to `loadCorpus`. The bigram table is a property of the language, so the
// three English corpora share `english-bigrams.json` and the two French ones
// share `french-bigrams.json`.
async function loadFromSources(
	id: BuiltinCorpusId,
	language: BigramLanguage,
	wordlistImport: () => Promise<{ default: string }>
): Promise<CorpusData> {
	const [{ default: raw }, bigramFrequencies] = await Promise.all([
		wordlistImport(),
		BIGRAM_LOADERS[language]()
	]);
	return loadCorpus(buildConfig(id, language), raw, bigramFrequencies);
}

const LOADERS: Record<BuiltinCorpusId, () => Promise<CorpusData>> = {
	'en-top-1000': () => loadFromSources('en-top-1000', 'en', () => import('./data/english1k.txt?raw')),
	'en-top-5000': () => loadFromSources('en-top-5000', 'en', () => import('./data/english5k.txt?raw')),
	'en-top-10000': () =>
		loadFromSources('en-top-10000', 'en', () => import('./data/english10k.txt?raw')),
	'fr-top-1500': () =>
		loadFromSources('fr-top-1500', 'fr', () => import('./data/french1_5k.txt?raw')),
	'fr-top-10000': () =>
		loadFromSources('fr-top-10000', 'fr', () => import('./data/french10k.txt?raw'))
};

function buildConfig(id: BuiltinCorpusId, language: string): CorpusConfig {
	// `wordlistId` mirrors `id` for built-ins — they're the same thing from
	// the config's POV. A custom corpus would carry a different wordlistId
	// pointing at the user's source.
	return { id, language, wordlistId: id };
}

/**
 * Type guard — narrow an arbitrary string (e.g. from user settings or a
 * URL param) to a known built-in id before attempting to load.
 */
export function isBuiltinCorpusId(id: string): id is BuiltinCorpusId {
	return (BUILTIN_CORPUS_IDS as readonly string[]).includes(id);
}

/**
 * Load a built-in corpus by id. Resolves with the fully-derived
 * {@link CorpusData}. Rejects if the id is unknown — caller should use
 * {@link isBuiltinCorpusId} first if the input is user-controlled.
 *
 * In-memory cache intentionally absent here. A corpus is a few hundred
 * KB of objects and gets loaded when the user picks it; if we add a
 * cache later, the cache belongs in the `stores/` layer (session-wide
 * state) not here (pure data fetcher).
 */
export async function loadBuiltinCorpus(id: BuiltinCorpusId): Promise<CorpusData> {
	const loader = LOADERS[id];
	if (!loader) throw new Error(`Unknown built-in corpus id: ${id}`);
	return loader();
}

/**
 * Languages with a shipped quote bank. Kept as a separate dimension from
 * `BUILTIN_CORPUS_IDS` because a user might pick a wordlist-only language
 * (or a custom corpus) — we shouldn't pretend quotes are always available.
 */
export const QUOTE_BANK_LANGUAGES = ['en', 'fr'] as const;
export type QuoteBankLanguage = (typeof QUOTE_BANK_LANGUAGES)[number];

const QUOTE_LOADERS: Record<QuoteBankLanguage, () => Promise<QuoteBank>> = {
	/*
	 * JSON imports use Vite's default JSON handling (no `?raw`) — the file
	 * parses at build time and the module yields the parsed object. This
	 * stays code-split per language so English users don't pay for the
	 * French bank.
	 */
	en: async () => {
		const mod = await import('./data/english-quotes.json');
		// JSON imports type as `number[][]` which won't narrow to our tuple
		// `[min, max]` shape. Double-cast via `unknown` — the data is author-
		// controlled and the schema is stable; a narrower runtime validator
		// would be overkill for a build-time asset.
		return mod.default as unknown as QuoteBank;
	},
	fr: async () => {
		const mod = await import('./data/french-quotes.json');
		// JSON imports type as `number[][]` which won't narrow to our tuple
		// `[min, max]` shape. Double-cast via `unknown` — the data is author-
		// controlled and the schema is stable; a narrower runtime validator
		// would be overkill for a build-time asset.
		return mod.default as unknown as QuoteBank;
	}
};

export function hasQuoteBank(language: string): language is QuoteBankLanguage {
	return (QUOTE_BANK_LANGUAGES as readonly string[]).includes(language);
}

/**
 * Load a language's quote bank. Rejects on unknown languages — callers
 * should gate on {@link hasQuoteBank} first.
 */
export async function loadQuoteBank(language: QuoteBankLanguage): Promise<QuoteBank> {
	const loader = QUOTE_LOADERS[language];
	if (!loader) throw new Error(`No quote bank for language: ${language}`);
	return loader();
}
