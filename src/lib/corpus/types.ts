/** `token` → raw count or normalized weight. Callers interpret the units. */
export type FrequencyTable = Record<string, number>;

/** Short prose excerpt with attribution; atomic unit for a passage. */
export interface Quote {
	id: number;
	text: string;
	source: string;
	/** Character count of `text`; redundant but handy for length filtering. */
	length: number;
}

/** Quote bank. Quotes pre-carry `length` so filtering is constant-time. */
export interface QuoteBank {
	language: string;
	quotes: readonly Quote[];
}

/** Half-open `[start, end)` character range of one quote inside a passage. */
export interface QuoteSpan {
	start: number;
	end: number;
}

/**
 * Assembled prose plus where its quotes sit in it. The spans are what lets a
 * reader treat the passage as the quotes it was made of rather than one string.
 */
export interface Passage {
	text: string;
	quotes: readonly QuoteSpan[];
}
