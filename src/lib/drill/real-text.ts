import type { CorpusData, Quote, QuoteBank, QuoteLengthGroup } from '../corpus/types';
import { selectQuote } from '../corpus/quotes';
import { selectRealTextSentence } from '../corpus/selection';

/**
 * Real-text session sequence generation (spec §4.2).
 *
 * Given a quote bank (preferred) and/or a fallback wordlist corpus,
 * emits a concatenated passage long enough to fill a session. Callers
 * either supply `targetLengthChars` (a character target — roughly
 * matches WPM × duration) or accept the default.
 *
 * Output is a plain string the typing surface consumes. A richer shape
 * (per-quote boundaries, source attribution) is also returned so future
 * UI can render attribution between chunks without re-parsing.
 */

/**
 * Separator between concatenated segments. Kept at a single space so
 * synth-path sentences (which are themselves space-joined words) don't
 * produce jarring double-spaces at sentence boundaries in the typing
 * surface — an effect users were noticing on the diagnostic.
 */
const QUOTE_SEPARATOR = ' ';

/**
 * Default character target. 1400 chars ≈ 5 minutes at 60 WPM (60 × 5 =
 * 300 words × ~5 chars + spaces). The session runner can ask for
 * whatever it wants — this is purely a default for callers that don't
 * care.
 */
const DEFAULT_TARGET_LENGTH_CHARS = 1400;

export interface RealTextInput {
	/**
	 * Preferred source: a quote bank for the session's language. When
	 * supplied, selection pulls real prose chunks with attribution.
	 */
	quoteBank?: QuoteBank;
	/**
	 * Fallback source: a loaded wordlist corpus. Used only when no quote
	 * bank is available (e.g. custom corpus or an unsupported language).
	 * If both are omitted, the generator throws.
	 */
	fallbackCorpus?: CorpusData;
	/** Target-bigram bias for both paths (spec §4.2 heuristic). */
	targetBigrams?: readonly string[];
	options?: RealTextOptions;
}

export interface RealTextOptions {
	/** Target character count; default 1400. Actual output may exceed by one chunk. */
	targetLengthChars?: number;
	/** Length-bucket filter for the quote path. Ignored by the word-synth fallback. */
	quoteLengthGroup?: QuoteLengthGroup;
	/**
	 * How many words per synthesized "sentence" in the fallback path.
	 * Ignored by the quote path.
	 */
	synthWordsPerSentence?: number;
	/** Max chunks (quotes or synth sentences) to concatenate — safety valve. */
	maxChunks?: number;
	/** Injectable RNG. Defaults to `Math.random`. */
	rng?: () => number;
}

/** Provenance of each assembled chunk — lets UI render source lines. */
export type RealTextSegment =
	| { kind: 'quote'; text: string; quote: Quote }
	| { kind: 'synth'; text: string };

export interface RealTextSequence {
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
 * Generate a real-text sequence.
 *
 * Selection preference:
 *   1. Quote bank — picks prose chunks via `selectQuote` until the
 *      character target is met, rotating through the bank without
 *      repeating an id within a single call.
 *   2. Fallback corpus — synthesizes sentences via
 *      `selectRealTextSentence` until the target is met.
 *
 * Throws when neither source is supplied. That's a programming bug, not
 * a user-facing condition.
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

	// Don't walk the whole bank trying to avoid already-used ids if we've
	// exhausted available quotes — bail and either synth-pad or stop.
	while (charCount < opts.targetLen && segments.length < opts.maxChunks) {
		if (usedIds.size >= bank.quotes.length) break;

		// Tight retry loop to skip already-picked ids. `selectQuote` doesn't
		// support exclusion; sampling with rejection is fine at typical
		// usage (a session needs ~10 quotes out of thousands).
		const quote = pickUnusedQuote(bank, usedIds, opts);
		if (!quote) break;
		usedIds.add(quote.id);
		segments.push({ kind: 'quote', text: quote.text, quote });
		charCount += quote.text.length;
	}

	// Quote bank exhausted before we hit the length target — optionally
	// pad with synthesized sentences if a fallback corpus is available.
	// Otherwise return what we have.
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

/**
 * Try up to a few attempts to pull a quote with a fresh id. Returns
 * `null` if we can't find one after many tries — caller bails out.
 */
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
	// Rare: targetBigrams biased the bank so hard that the first few
	// matches repeat. Find any unused quote by linear scan as a last
	// resort — guaranteed to succeed if any unused quote exists at all.
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
