/** Frequency tables are derived from text on load, not stored — recomputing is cheap. */
export interface CorpusConfig {
	id: string;
	language: string;
	/** Built-in wordlist reference, e.g. `"en-top-1000"`. */
	wordlistId: string;
	/** User-supplied text for custom corpora. */
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

/** Short prose excerpt with attribution; atomic unit for real-text sessions. */
export interface Quote {
	id: number;
	text: string;
	source: string;
	/** Character count of `text`; redundant but handy for length-bucket filtering. */
	length: number;
}

/** `[minInclusive, maxInclusive]` length bucket — UI gets filters without hard-coded numbers. */
export type QuoteLengthGroup = readonly [number, number];

/** Quote bank. Quotes pre-carry `length` so filtering is constant-time. */
export interface QuoteBank {
	language: string;
	groups: readonly QuoteLengthGroup[];
	quotes: readonly Quote[];
}
