import type { CorpusConfig, CorpusData } from './types';
import { loadCorpus } from './loader';

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
const LOADERS: Record<BuiltinCorpusId, () => Promise<CorpusData>> = {
	'en-top-1000': async () => {
		const { default: raw } = await import('./data/english1k.txt?raw');
		return loadCorpus(buildConfig('en-top-1000', 'en'), raw);
	},
	'en-top-5000': async () => {
		const { default: raw } = await import('./data/english5k.txt?raw');
		return loadCorpus(buildConfig('en-top-5000', 'en'), raw);
	},
	'en-top-10000': async () => {
		const { default: raw } = await import('./data/english10k.txt?raw');
		return loadCorpus(buildConfig('en-top-10000', 'en'), raw);
	},
	'fr-top-1500': async () => {
		const { default: raw } = await import('./data/french1_5k.txt?raw');
		return loadCorpus(buildConfig('fr-top-1500', 'fr'), raw);
	},
	'fr-top-10000': async () => {
		const { default: raw } = await import('./data/french10k.txt?raw');
		return loadCorpus(buildConfig('fr-top-10000', 'fr'), raw);
	}
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
