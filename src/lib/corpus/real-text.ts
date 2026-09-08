import type { Quote, QuoteBank, QuoteLengthGroup } from './types';
import { selectQuote } from './quotes';
import { selectQuoteByDebt } from './debt-selection';

/**
 * Assemble a passage from a quote bank.
 *
 * Two ways to pick each quote. With `bigramDebts`, by how much outstanding
 * debt the quote repays per keystroke. Without — a first session, nothing owed
 * yet — by uniform sampling, since there is nothing to score against.
 *
 * There is no synthesised fallback any longer: word-synth existed for the
 * diagnostic, and generated text trains transitions inside nonsense the
 * fingers will never meet again.
 */

/** Single space — double-space would look jarring between quotes. */
const QUOTE_SEPARATOR = ' ';

/** 1400 chars ≈ 5 min at 60 WPM. */
const DEFAULT_TARGET_LENGTH_CHARS = 1400;

/** Stop adding quotes once we're within 15% of target — close enough beats overshoot. */
const CLOSE_ENOUGH_RATIO = 0.85;

/** Prefer quotes that fit the remaining gap to within +50%. Soft cap; falls through if no fit. */
const MAX_OVERSHOOT_RATIO = 1.5;

interface RealTextInput {
	/** The only source of material: a quote bank for the session's language. */
	quoteBank: QuoteBank;
	/** Second-language bank; with `secondaryMix > 0`, each draw rolls to pick a bank. */
	secondaryQuoteBank?: QuoteBank;
	/** 0..100 share of draws taken from `secondaryQuoteBank`. */
	secondaryMix?: number;
	/** Target-bigram sampling bias. Ignored when `bigramDebts` is given. */
	targetBigrams?: readonly string[];
	/**
	 * Clean repeats each bigram still owes. Present → quotes are picked by
	 * repayable debt per keystroke instead of by target-bigram weighting. An
	 * empty map means nothing is owed, so selection falls back to sampling.
	 */
	bigramDebts?: ReadonlyMap<string, number>;
	options?: RealTextOptions;
}

interface RealTextOptions {
	/** Target character count; default 1400. Actual output may exceed by one chunk. */
	targetLengthChars?: number;
	/** Length-bucket filter. */
	quoteLengthGroup?: QuoteLengthGroup;
	/** Max quotes to concatenate — safety valve. */
	maxChunks?: number;
	/** Injectable RNG. Defaults to `Math.random`. */
	rng?: () => number;
}

/** Provenance of each quote — lets UI render source lines. */
interface RealTextSegment {
	text: string;
	quote: Quote;
}

interface RealTextSequence {
	/** Concatenated passage — feeds directly into the typing surface. */
	text: string;
	segments: RealTextSegment[];
	stats: { chunks: number; chars: number };
}

/** Concatenate quotes up to the char target, no id repeated within a call. */
export function generateRealTextSequence(input: RealTextInput): RealTextSequence {
	const options = input.options ?? {};

	return buildFromQuotes(input.quoteBank, {
		targetBigrams: input.targetBigrams ?? [],
		bigramDebts: input.bigramDebts,
		targetLen: options.targetLengthChars ?? DEFAULT_TARGET_LENGTH_CHARS,
		maxChunks: options.maxChunks ?? 200,
		lengthGroup: options.quoteLengthGroup,
		rng: options.rng ?? Math.random,
		secondaryBank: input.secondaryQuoteBank,
		secondaryMix: input.secondaryMix ?? 0
	});
}

function buildFromQuotes(
	bank: QuoteBank,
	opts: {
		targetBigrams: readonly string[];
		bigramDebts?: ReadonlyMap<string, number>;
		targetLen: number;
		maxChunks: number;
		lengthGroup?: QuoteLengthGroup;
		rng: () => number;
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
		segments.push({ text: quote.text, quote });
		charCount += quote.text.length;
	}

	return {
		text: segments.map((s) => s.text).join(QUOTE_SEPARATOR),
		segments,
		stats: { chunks: segments.length, chars: charCount }
	};
}

// With a debt map, hand off to debt scoring. Otherwise: up to 30 samples for a
// fresh id that fits the remaining gap, then relax the length cap, then linear
// scan as a last resort.
function pickUnusedQuote(
	bank: QuoteBank,
	used: Set<number>,
	opts: {
		targetBigrams: readonly string[];
		bigramDebts?: ReadonlyMap<string, number>;
		lengthGroup?: QuoteLengthGroup;
		rng: () => number;
		remainingGap: number;
	}
): Quote | null {
	if (opts.bigramDebts && opts.bigramDebts.size > 0) {
		return selectQuoteByDebt(bank, {
			debts: opts.bigramDebts,
			used,
			remainingGap: opts.remainingGap,
			rng: opts.rng
		});
	}

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
