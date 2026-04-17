import type { Quote, QuoteBank, QuoteLengthGroup } from './types';

/**
 * Multiplier on a quote's sampling weight for every occurrence of a
 * target bigram inside it. Matches the convention in `selection.ts` for
 * symbolic uniformity, but the effect here is per-occurrence (not per-
 * target-present-or-not) because quotes are long enough that presence
 * is ~uniform — counting occurrences bubbles up genuinely bigram-dense
 * quotes.
 */
const TARGET_OCCURRENCE_MULTIPLIER = 1.5;

export interface SelectQuoteOptions {
	/**
	 * Bigrams we want the quote to contain. An empty or missing list →
	 * uniform sampling. The boost is multiplicative per occurrence, so a
	 * quote containing a target bigram 3 times beats one that contains it
	 * once.
	 */
	targetBigrams?: readonly string[];
	/**
	 * Limit candidates to quotes whose length falls inside this
	 * `[min, max]` inclusive bucket. Useful for length-tuned sessions
	 * ("give me only short quotes" / "warm up with a long one"). If the
	 * bucket contains no quotes, we fall back to the full bank so the
	 * session can always start — call sites that would rather fail
	 * loud should filter upstream.
	 */
	lengthGroup?: QuoteLengthGroup;
	/** Injectable RNG for tests. Defaults to `Math.random`. */
	rng?: () => number;
}

/**
 * Pick one quote from a bank, weighted by target-bigram density.
 *
 * Throws on an empty bank — silent "no quote" masks a configuration bug.
 */
export function selectQuote(bank: QuoteBank, options: SelectQuoteOptions = {}): Quote {
	if (bank.quotes.length === 0) {
		throw new Error(`selectQuote: quote bank for ${bank.language} is empty`);
	}

	const candidates = filterByLength(bank.quotes, options.lengthGroup);
	const pool = candidates.length > 0 ? candidates : bank.quotes;

	const rng = options.rng ?? Math.random;
	const weights = buildWeights(pool, options.targetBigrams ?? []);
	const total = weights.reduce((a, b) => a + b, 0);

	// All-zero weights (e.g. all-empty quotes — shouldn't happen in real
	// data) → uniform fallback so we still return something.
	if (total <= 0) {
		return pool[Math.floor(rng() * pool.length)];
	}

	const target = rng() * total;
	let running = 0;
	for (let i = 0; i < pool.length; i++) {
		running += weights[i];
		if (target < running) return pool[i];
	}
	// Floating-point fallback — see `selection.ts` for the same pattern.
	return pool[pool.length - 1];
}

/**
 * `[min, max]` inclusive length filter. Matches the bank's own `groups`
 * convention.
 */
function filterByLength(quotes: readonly Quote[], group?: QuoteLengthGroup): Quote[] {
	if (!group) return [...quotes];
	const [min, max] = group;
	return quotes.filter((q) => q.length >= min && q.length <= max);
}

/**
 * Base weight 1 per quote; multiplied by {@link TARGET_OCCURRENCE_MULTIPLIER}
 * for each target-bigram occurrence. Case-sensitive (consistent with
 * `selection.ts`).
 */
function buildWeights(quotes: readonly Quote[], targets: readonly string[]): number[] {
	if (targets.length === 0) return quotes.map(() => 1);
	const out = new Array<number>(quotes.length);
	for (let i = 0; i < quotes.length; i++) {
		let weight = 1;
		const text = quotes[i].text;
		for (const t of targets) {
			if (t.length < 2) continue;
			const occurrences = countOccurrences(text, t);
			for (let k = 0; k < occurrences; k++) weight *= TARGET_OCCURRENCE_MULTIPLIER;
		}
		out[i] = weight;
	}
	return out;
}

/** Non-overlapping occurrence count — fast enough for the ~10k-quote pools we deal with. */
function countOccurrences(haystack: string, needle: string): number {
	if (needle.length === 0) return 0;
	let count = 0;
	let idx = 0;
	while (true) {
		const found = haystack.indexOf(needle, idx);
		if (found === -1) return count;
		count++;
		idx = found + needle.length;
	}
}
