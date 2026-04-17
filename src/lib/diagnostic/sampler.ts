/**
 * Diagnostic passage generator. Prefers the quote bank (real prose — the
 * passage's bigram distribution then matches the language's natural
 * distribution, no target biasing needed). Falls back to word-synth from the
 * corpus when the language has no quote bank. RNG is injectable for tests.
 */
import type { CorpusData, QuoteBank } from '../corpus/types';
import { generateRealTextSequence } from '../drill/real-text';

/** ~5–8 min of typing at 60 WPM — enough samples per top bigram without dragging. */
export const DEFAULT_DIAGNOSTIC_CHAR_TARGET = 700;

export interface DiagnosticSamplerOptions {
	/** Overrides the default char target (mostly for tests). */
	targetChars?: number;
	/** Injectable RNG so tests and replay can pin output. */
	rng?: () => number;
	/**
	 * Preferred source: real prose from a quote bank. Absent → the sampler
	 * falls through to `corpus` word-synth, which is honest but noisier
	 * (frequencies are Zipf-of-rank, vocabulary is truncated).
	 */
	quoteBank?: QuoteBank;
}

export interface DiagnosticPassage {
	text: string;
	stats: {
		chars: number;
		chunks: number;
		source: 'quote-bank' | 'word-synth' | 'quote-bank-exhausted';
	};
}

// Produce a diagnostic passage. Sync on purpose so routes can generate
// during load without extra awaits.
export function sampleDiagnosticPassage(
	corpus: CorpusData,
	options: DiagnosticSamplerOptions = {}
): DiagnosticPassage {
	const targetChars = options.targetChars ?? DEFAULT_DIAGNOSTIC_CHAR_TARGET;

	const seq = generateRealTextSequence({
		quoteBank: options.quoteBank,
		fallbackCorpus: corpus,
		// No `targetBigrams` — let the natural bigram distribution stand.
		// The diagnostic wants to measure the user on representative text,
		// not on text engineered to over-sample a chosen subset of bigrams.
		options: {
			targetLengthChars: targetChars,
			rng: options.rng
		}
	});

	return {
		text: seq.text,
		stats: seq.stats
	};
}
