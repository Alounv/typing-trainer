import type { Quote, QuoteBank } from './types';
import { selectQuoteByDebt } from './debt-selection';

/**
 * Assemble a passage by concatenating quotes up to a character target.
 *
 * Two ways to pick each quote. With outstanding `bigramDebts`, by how much of
 * that debt the quote repays per keystroke. Without — a first session, nothing
 * owed yet — uniformly at random, since there is nothing to score against.
 *
 * There is no synthesised fallback: word-synth existed for the diagnostic, and
 * generated text trains transitions inside nonsense the fingers will never meet
 * again.
 */

/** Single space — double-space would look jarring between quotes. */
const QUOTE_SEPARATOR = ' ';

/** Stop adding quotes once we're within 15% of target — close enough beats overshoot. */
const CLOSE_ENOUGH_RATIO = 0.85;

/** Safety valve on a bank of very short quotes. */
const MAX_QUOTES = 200;

/** Accept a quote up to 50% past the remaining gap; beyond that, keep looking. */
const MAX_OVERSHOOT_RATIO = 1.5;

interface PassageSpec {
	bank: QuoteBank;
	/** Second-language bank; with `secondaryMix > 0`, each draw rolls to pick a bank. */
	secondaryBank?: QuoteBank;
	/** 0..100 share of draws taken from `secondaryBank`. */
	secondaryMix?: number;
	targetLengthChars: number;
	/** Clean repeats each bigram owes. Empty or absent → uniform sampling. */
	bigramDebts?: ReadonlyMap<string, number>;
	/** Injectable RNG. Defaults to `Math.random`. */
	rng?: () => number;
}

/** A bank plus the ids already spent from it. Ids are only unique within a
 *  bank, so the two languages must not share one set. */
interface Draw {
	bank: QuoteBank;
	used: Set<number>;
}

export function buildPassage(spec: PassageSpec): string {
	const rng = spec.rng ?? Math.random;
	const debts = spec.bigramDebts?.size ? spec.bigramDebts : undefined;

	const primary: Draw = { bank: spec.bank, used: new Set() };
	// A mix of 0 means the second language is not in play at all — not even as
	// a fallback once the primary runs dry.
	const mix = spec.secondaryMix ?? 0;
	const secondary: Draw | null =
		spec.secondaryBank && mix > 0 ? { bank: spec.secondaryBank, used: new Set() } : null;

	const texts: string[] = [];
	let chars = 0;

	while (chars < spec.targetLengthChars * CLOSE_ENOUGH_RATIO && texts.length < MAX_QUOTES) {
		const preferred = secondary && rng() * 100 < mix ? secondary : primary;
		const other = preferred === primary ? secondary : primary;
		const remainingGap = spec.targetLengthChars - chars;

		// The picked bank can be exhausted while the other still has material.
		const drawn =
			draw(preferred, remainingGap, debts, rng) ??
			(other ? draw(other, remainingGap, debts, rng) : null);
		if (!drawn) break;

		texts.push(drawn.text);
		chars += drawn.text.length;
	}

	return texts.join(QUOTE_SEPARATOR);
}

/** Take one quote out of `from`, marking it spent. `null` once it is exhausted. */
function draw(
	from: Draw,
	remainingGap: number,
	debts: ReadonlyMap<string, number> | undefined,
	rng: () => number
): Quote | null {
	const quote = pick(from.bank, from.used, remainingGap, debts, rng);
	if (quote) from.used.add(quote.id);
	return quote;
}

/**
 * One unused quote from `bank`, or `null` when the bank is exhausted.
 *
 * Rejection sampling, preferring quotes that fit the remaining gap; a
 * sampled-but-too-long quote is accepted rather than starving the passage.
 * Fine at ~10 quotes drawn from thousands.
 */
function pick(
	bank: QuoteBank,
	used: ReadonlySet<number>,
	remainingGap: number,
	debts: ReadonlyMap<string, number> | undefined,
	rng: () => number
): Quote | null {
	if (debts) return selectQuoteByDebt(bank, { debts, used, remainingGap, rng });

	const maxLength = remainingGap * MAX_OVERSHOOT_RATIO;
	for (let i = 0; i < 30; i++) {
		const quote = bank.quotes[Math.floor(rng() * bank.quotes.length)];
		if (!quote || used.has(quote.id) || quote.text.length > maxLength) continue;
		return quote;
	}
	// Nothing sampled fit — see `selectQuoteByDebt`, which falls back the same way.
	for (const quote of bank.quotes) if (!used.has(quote.id)) return quote;
	return null;
}
