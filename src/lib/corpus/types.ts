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
