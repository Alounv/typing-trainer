import type { Quote, QuoteBank } from './types';

/**
 * Passage selection by outstanding debt.
 *
 * The shift here is from *generating* text to *choosing* it: real prose is the
 * only material, so the lever is which passage comes next, scored by how much
 * of what the typist owes it can repay.
 *
 * Delivery and accounting stay separate — real words are what you type,
 * transitions are what gets credited. Typing `brown` pays down `br ro ow wn`,
 * so `crown` benefits without ever appearing. That is why no corpus of all
 * words is needed: the quotes supply the words, and the ledger only ever holds
 * a few hundred transitions.
 */

/** Candidates sampled per pick. Best-of-a-sample, not global best, so the same
 *  few quotes don't come back every session. */
const DEFAULT_SAMPLE_SIZE = 40;

/** Accept a quote up to 50% past the remaining gap; beyond that, keep looking. */
const MAX_OVERSHOOT_RATIO = 1.5;

/**
 * Debt this passage can actually repay, per keystroke spent.
 *
 * `min(occurrences, debt)` is what makes it *repayable* rather than merely
 * present: a quote containing `th` forty times gets no credit for forty if `th`
 * owes four. Dividing by length stops a long quote winning on bulk — the
 * question is what the next two minutes buy, not what the next ten do.
 *
 * Case-sensitive, matching how bigrams are recorded (`Th` and `th` are
 * different transitions for the fingers, and the ledger keeps them apart).
 */
export function scoreQuoteByDebt(text: string, debts: ReadonlyMap<string, number>): number {
	if (text.length < 2 || debts.size === 0) return 0;

	const counts = new Map<string, number>();
	for (let i = 0; i + 1 < text.length; i++) {
		const bigram = text.slice(i, i + 2);
		if (!debts.has(bigram)) continue;
		counts.set(bigram, (counts.get(bigram) ?? 0) + 1);
	}

	let repayable = 0;
	for (const [bigram, occurrences] of counts) {
		repayable += Math.min(occurrences, debts.get(bigram)!);
	}
	return repayable / text.length;
}

interface DebtSelectionOptions {
	debts: ReadonlyMap<string, number>;
	/** Quote ids already used in this passage — never repeated within one session. */
	used: ReadonlySet<number>;
	/** Chars still wanted. Quotes far past it lose on the per-keystroke divisor
	 *  anyway, so this only guards against a single overshooting monster. */
	remainingGap: number;
	sampleSize?: number;
	rng?: () => number;
}

/**
 * Best of a random sample of unused quotes, by repayable debt per keystroke.
 *
 * Returns `null` only when the bank holds no unused quote at all — the caller
 * decides whether that ends the passage.
 */
export function selectQuoteByDebt(bank: QuoteBank, options: DebtSelectionOptions): Quote | null {
	const rng = options.rng ?? Math.random;
	const sampleSize = options.sampleSize ?? DEFAULT_SAMPLE_SIZE;
	const maxLength = options.remainingGap * MAX_OVERSHOOT_RATIO;

	let best: Quote | null = null;
	let bestScore = -1;

	for (let i = 0; i < sampleSize; i++) {
		const quote = bank.quotes[Math.floor(rng() * bank.quotes.length)];
		if (!quote || options.used.has(quote.id) || quote.text.length > maxLength) continue;

		const score = scoreQuoteByDebt(quote.text, options.debts);
		if (score > bestScore) {
			best = quote;
			bestScore = score;
		}
	}

	if (best) return best;
	// Nothing sampled fit: either every remaining quote overshoots the gap, or
	// the bank is near-exhausted and the sample kept landing on used ids. Both
	// want the same answer — any unused quote, overshoot included, because one
	// quote too long beats a passage that cannot be finished.
	for (const quote of bank.quotes) if (!options.used.has(quote.id)) return quote;
	return null;
}
