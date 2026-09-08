import type { QuoteBank } from './types';
import { generateRealTextSequence } from './real-text';

interface TextSpec {
	quoteBank: QuoteBank;
	/** Second-language bank for mixed sessions; 0..100 share via `secondaryMix`. */
	secondaryQuoteBank?: QuoteBank;
	secondaryMix?: number;
	targetLengthChars: number;
	/** Clean repeats each bigram owes — drives passage choice. */
	bigramDebts?: ReadonlyMap<string, number>;
}

/**
 * Single entry for producing a text to type.
 *
 * One kind now. The `bigram-drill` and `diagnostic` variants went with their
 * session types, and with them the last callers of word-synth — so a passage is
 * always real prose, selected rather than assembled from frequencies.
 */
export function generateText(spec: TextSpec): { text: string } {
	return generateRealTextSequence({
		quoteBank: spec.quoteBank,
		secondaryQuoteBank: spec.secondaryQuoteBank,
		secondaryMix: spec.secondaryMix,
		bigramDebts: spec.bigramDebts,
		options: { targetLengthChars: spec.targetLengthChars }
	});
}
