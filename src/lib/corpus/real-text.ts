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

/** Stop adding quotes once we're within 15% of target — close enough beats overshoot. */
const CLOSE_ENOUGH_RATIO = 0.85;

/** Prefer quotes that fit the remaining gap to within +50%. Soft cap; falls through if no fit. */
const MAX_OVERSHOOT_RATIO = 1.5;

interface RealTextInput {
	/** Preferred source: a quote bank for the session's language. */
	quoteBank?: QuoteBank;
	/** Second-language bank; with `secondaryMix > 0`, each draw rolls to pick a bank. */
	secondaryQuoteBank?: QuoteBank;
	/** 0..100 share of draws taken from `secondaryQuoteBank`. */
	secondaryMix?: number;
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
			synthWordsPerSentence: options.synthWordsPerSentence,
			secondaryBank: input.secondaryQuoteBank,
			secondaryMix: input.secondaryMix ?? 0
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
		secondaryBank?: QuoteBank;
		secondaryMix: number;
	}
): RealTextSequence {
	const segments: RealTextSegment[] = [];
	const usedPrimary = new Set<number>();
	const usedSecondary = new Set<number>();
	let charCount = 0;
	const closeEnough = opts.targetLen * CLOSE_ENOUGH_RATIO;
	const mixActive = !!opts.secondaryBank && opts.secondaryMix > 0;

	while (charCount < closeEnough && segments.length < opts.maxChunks) {
		const useSecondary = mixActive && opts.rng() * 100 < opts.secondaryMix;
		const activeBank = useSecondary ? opts.secondaryBank! : bank;
		const activeUsed = useSecondary ? usedSecondary : usedPrimary;

		// Stop when both banks are exhausted.
		const primaryExhausted = usedPrimary.size >= bank.quotes.length;
		const secondaryExhausted =
			!opts.secondaryBank || usedSecondary.size >= opts.secondaryBank.quotes.length;
		if (primaryExhausted && (!mixActive || secondaryExhausted)) break;

		// Picked bank exhausted → swap to the other.
		const swappedBank = activeUsed.size >= activeBank.quotes.length;
		const finalBank = swappedBank ? (useSecondary ? bank : opts.secondaryBank!) : activeBank;
		const finalUsed = swappedBank ? (useSecondary ? usedPrimary : usedSecondary) : activeUsed;

		// Rejection sampling — fine at ~10 quotes out of thousands per session.
		const remainingGap = opts.targetLen - charCount;
		const quote = pickUnusedQuote(finalBank, finalUsed, { ...opts, remainingGap });
		if (!quote) break;
		finalUsed.add(quote.id);
		segments.push({ kind: 'quote', text: quote.text, quote });
		charCount += quote.text.length;
	}

	// Quote bank short of target → pad with synth if fallback corpus present.
	let source: RealTextSequence['stats']['source'] = 'quote-bank';
	if (charCount < closeEnough && opts.synthFallback) {
		source = 'quote-bank-exhausted';
		while (charCount < closeEnough && segments.length < opts.maxChunks) {
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

// Up to 30 samples for a fresh id that fits the remaining gap, then relax the
// length cap, then linear scan as a last resort.
function pickUnusedQuote(
	bank: QuoteBank,
	used: Set<number>,
	opts: {
		targetBigrams: readonly string[];
		lengthGroup?: QuoteLengthGroup;
		rng: () => number;
		remainingGap: number;
	}
): Quote | null {
	const maxAttempts = 30;
	const maxLen = opts.remainingGap * MAX_OVERSHOOT_RATIO;
	let fallback: Quote | null = null;
	for (let i = 0; i < maxAttempts; i++) {
		const q = selectQuote(bank, {
			targetBigrams: opts.targetBigrams,
			lengthGroup: opts.lengthGroup,
			rng: opts.rng
		});
		if (used.has(q.id)) continue;
		if (q.text.length <= maxLen) return q;
		if (!fallback) fallback = q;
	}
	// No fit found — accept a sampled-but-too-long quote rather than starve.
	if (fallback) return fallback;
	// Strong targetBigrams bias may keep returning the same matches.
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
