/**
 * User-selectable corpus (spec §2.6). Frequency tables are derived from the
 * text on load — not stored on the config — so recomputing is cheap.
 */
export interface CorpusConfig {
	id: string;
	language: string;
	/** Built-in wordlist reference, e.g. `"en-top-1000"`. */
	wordlistId: string;
	/** User-supplied text for custom corpora (spec §6.3). */
	customText?: string;
}

/** `token` → raw count or normalized weight. Callers interpret the units. */
export type FrequencyTable = Record<string, number>;

/** Loaded-in-memory corpus: config + derived frequencies. */
export interface CorpusData {
	config: CorpusConfig;
	wordFrequencies: FrequencyTable;
	bigramFrequencies: FrequencyTable;
}
