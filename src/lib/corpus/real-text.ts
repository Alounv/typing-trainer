import type { CorpusData, Quote, QuoteBank, QuoteLengthGroup } from './types';
import { selectQuote } from './quotes';
import { selectRealTextSentence } from './selection';

/**
 * Real-text passage generation. Prefers a quote bank (real prose with
 * attribution); falls back to word-synth when unavailable.
 */

/** Single space — double-space would look jarring between synth sentences. */
const QUOTE_SEPARATOR = ' ';

/** 1400 chars ≈ 5 min at 60 WPM. */
const DEFAULT_TARGET_LENGTH_CHARS = 1400;

interface RealTextInput {
	/** Preferred source: a quote bank for the session's language. */
	quoteBank?: QuoteBank;
	/** Fallback when no quote bank. Both omitted → throws. */
	fallbackCorpus?: CorpusData;
	/** Target-bigram bias for both paths. */
	targetBigrams?: readonly string[];
	options?: RealTextOptions;
}

interface RealTextOptions {
	/** Target character count; default 1400. Actual output may exceed by one chunk. */
	targetLengthChars?: number;
	/** Length-bucket filter for the quote path. Ignored by the word-synth fallback. */
	quoteLengthGroup?: QuoteLengthGroup;
	/** Words per synth sentence. Ignored by the quote path. */
	synthWordsPerSentence?: number;
	/** Max chunks (quotes or synth sentences) to concatenate — safety valve. */
	maxChunks?: number;
	/** Injectable RNG. Defaults to `Math.random`. */
	rng?: () => number;
}

/** Provenance of each assembled chunk — lets UI render source lines. */
type RealTextSegment =
	| { kind: 'quote'; text: string; quote: Quote }
	| { kind: 'synth'; text: string };

interface RealTextSequence {
	/** Concatenated passage — feeds directly into the typing surface. */
	text: string;
	segments: RealTextSegment[];
	stats: {
		chunks: number;
		chars: number;
		source: 'quote-bank' | 'word-synth' | 'quote-bank-exhausted';
	};
}

/**
 * Generate a real-text sequence. Quote bank first (no id repeats within a call);
 * fallback synth until char target is met. Throws when neither is supplied.
 */
export function generateRealTextSequence(input: RealTextInput): RealTextSequence {
	if (!input.quoteBank && !input.fallbackCorpus) {
		throw new Error('generateRealTextSequence: need quoteBank or fallbackCorpus');
	}

	const options = input.options ?? {};
	const targetLen = options.targetLengthChars ?? DEFAULT_TARGET_LENGTH_CHARS;
	const maxChunks = options.maxChunks ?? 200;
	const rng = options.rng ?? Math.random;

	if (input.quoteBank) {
		return buildFromQuotes(input.quoteBank, {
			targetBigrams: input.targetBigrams ?? [],
			targetLen,
			maxChunks,
			lengthGroup: options.quoteLengthGroup,
			rng,
			synthFallback: input.fallbackCorpus,
			synthWordsPerSentence: options.synthWordsPerSentence
		});
	}

	return buildFromSynth({
		corpus: input.fallbackCorpus!,
		targetBigrams: input.targetBigrams ?? [],
		targetLen,
		maxChunks,
		wordsPerSentence: options.synthWordsPerSentence,
		rng
	});
}

function buildFromQuotes(
	bank: QuoteBank,
	opts: {
		targetBigrams: readonly string[];
		targetLen: number;
		maxChunks: number;
		lengthGroup?: QuoteLengthGroup;
		rng: () => number;
		synthFallback?: CorpusData;
		synthWordsPerSentence?: number;
	}
): RealTextSequence {
	const segments: RealTextSegment[] = [];
	const usedIds = new Set<number>();
	let charCount = 0;

	while (charCount < opts.targetLen && segments.length < opts.maxChunks) {
		// Bail when the bank is exhausted instead of looping forever looking
		// for unused ids.
		if (usedIds.size >= bank.quotes.length) break;

		// Rejection sampling — fine at ~10 quotes out of thousands per session.
		const quote = pickUnusedQuote(bank, usedIds, opts);
		if (!quote) break;
		usedIds.add(quote.id);
		segments.push({ kind: 'quote', text: quote.text, quote });
		charCount += quote.text.length;
	}

	// Quote bank short of target → pad with synth if fallback corpus present.
	let source: RealTextSequence['stats']['source'] = 'quote-bank';
	if (charCount < opts.targetLen && opts.synthFallback) {
		source = 'quote-bank-exhausted';
		while (charCount < opts.targetLen && segments.length < opts.maxChunks) {
			const sentence = selectRealTextSentence(opts.synthFallback, {
				wordCount: opts.synthWordsPerSentence,
				targetBigrams: opts.targetBigrams,
				rng: opts.rng
			});
			segments.push({ kind: 'synth', text: sentence });
			charCount += sentence.length;
		}
	}

	return {
		text: segments.map((s) => s.text).join(QUOTE_SEPARATOR),
		segments,
		stats: { chunks: segments.length, chars: charCount, source }
	};
}

// Up to 30 samples for a fresh id, then linear scan as a last resort.
function pickUnusedQuote(
	bank: QuoteBank,
	used: Set<number>,
	opts: {
		targetBigrams: readonly string[];
		lengthGroup?: QuoteLengthGroup;
		rng: () => number;
	}
): Quote | null {
	const maxAttempts = 30;
	for (let i = 0; i < maxAttempts; i++) {
		const q = selectQuote(bank, {
			targetBigrams: opts.targetBigrams,
			lengthGroup: opts.lengthGroup,
			rng: opts.rng
		});
		if (!used.has(q.id)) return q;
	}
	// Fallback: strong targetBigrams bias may keep returning the same matches.
	for (const q of bank.quotes) if (!used.has(q.id)) return q;
	return null;
}

function buildFromSynth(opts: {
	corpus: CorpusData;
	targetBigrams: readonly string[];
	targetLen: number;
	maxChunks: number;
	wordsPerSentence?: number;
	rng: () => number;
}): RealTextSequence {
	const segments: RealTextSegment[] = [];
	let charCount = 0;

	while (charCount < opts.targetLen && segments.length < opts.maxChunks) {
		const sentence = selectRealTextSentence(opts.corpus, {
			wordCount: opts.wordsPerSentence,
			targetBigrams: opts.targetBigrams,
			rng: opts.rng
		});
		segments.push({ kind: 'synth', text: sentence });
		charCount += sentence.length;
	}

	return {
		text: segments.map((s) => s.text).join(QUOTE_SEPARATOR),
		segments,
		stats: { chunks: segments.length, chars: charCount, source: 'word-synth' }
	};
}
