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

/**
 * One quote — short prose excerpt with attribution. Used as the atomic
 * unit for real-text sessions (spec §4.2) when a quote bank is available
 * for the session's language.
 */
export interface Quote {
	id: number;
	text: string;
	source: string;
	/** Character count of `text`; redundant but handy for length-bucket filtering. */
	length: number;
}

/**
 * `[minInclusive, maxInclusive]` length bucket. The bank ships an ordered
 * array of these so the UI can show canonical "short / medium / long /
 * very long" filters without hard-coding numbers.
 */
export type QuoteLengthGroup = readonly [number, number];

/**
 * A language's full quote bank (spec §4.2). Groups are length buckets;
 * quotes themselves carry `length` so filtering is a constant-time check
 * rather than a re-measurement.
 */
export interface QuoteBank {
	language: string;
	groups: readonly QuoteLengthGroup[];
	quotes: readonly Quote[];
}
