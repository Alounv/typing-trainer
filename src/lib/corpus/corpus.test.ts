import { describe, expect, it } from 'vitest';
import { buildPassage, loadBigramFrequencies, loadQuoteBank } from './index';
// One level in: debt scoring is the domain's core algorithm and is worth
// testing directly, but production only ever reaches it through `buildPassage`.
import { scoreQuoteByDebt, selectQuoteByDebt } from './debt-selection';
import type { QuoteBank } from './types';

function fixtureQuoteBank(): QuoteBank {
	return {
		language: 'en',
		quotes: [
			{ id: 1, text: 'The quick brown fox jumps over the lazy dog.', source: 't', length: 44 },
			{ id: 2, text: 'A stitch in time saves nine and then some.', source: 't', length: 42 },
			{ id: 3, text: 'Every journey begins with a single careful step.', source: 't', length: 48 }
		]
	};
}

function fixtureSecondaryBank(): QuoteBank {
	return {
		language: 'fr',
		quotes: [
			{
				id: 1,
				text: 'Un voyage commence toujours par un premier pas vers ailleurs.',
				source: 's',
				length: 61
			},
			{
				id: 2,
				text: 'Petit oiseau fait nid avec patience et constance chaque matin.',
				source: 's',
				length: 62
			}
		]
	};
}

describe('registry', () => {
	it('loads the en bigram table', async () => {
		const freq = await loadBigramFrequencies('en');
		expect(Object.keys(freq!).length).toBeGreaterThanOrEqual(100);
	});

	it('populates word-boundary bigrams on the same scale as interior bigrams', async () => {
		const freq = (await loadBigramFrequencies('en'))!;
		// "the" is the top word → " t" and "e " should beat the corpus floor by orders of
		// magnitude; otherwise priority ranking buries them (see `summarizeBigrams`).
		expect(freq[' t']).toBeGreaterThan(0);
		expect(freq['e ']).toBeGreaterThan(0);
		expect(freq[' t']).toBeGreaterThan(freq['th'] / 100);
	});

	it('reports no frequencies for a language that ships none', async () => {
		expect(await loadBigramFrequencies('de')).toBeUndefined();
	});

	it('loads the en quote bank', async () => {
		const bank = await loadQuoteBank('en');
		expect(bank.quotes.length).toBeGreaterThan(50);
	});
});

describe('buildPassage', () => {
	it('assembles the passage from the bank verbatim', () => {
		const bank = fixtureQuoteBank();
		const text = buildPassage({ bank, targetLengthChars: 40 });
		// The output must reproduce at least one quote's text verbatim — we don't
		// care which, just that real prose is the source and nothing rewrites it.
		expect(bank.quotes.some((q) => text.includes(q.text))).toBe(true);
	});

	it('prefers quotes that repay debt', () => {
		const bank: QuoteBank = {
			language: 'en',
			quotes: [
				{ id: 1, text: 'zzz zzz zzz zzz zzz zzz.', source: 't', length: 24 },
				{ id: 2, text: 'abab abab abab abab abab.', source: 't', length: 25 }
			]
		};
		const text = buildPassage({
			bank,
			targetLengthChars: 20,
			bigramDebts: new Map([['ab', 10]])
		});
		expect(text).toContain('abab');
	});

	// `rng() * 100 < secondaryMix` is deterministic at 0 (always primary) and at
	// 100 (always secondary, since Math.random < 1) — no RNG injection needed.
	describe('language mix', () => {
		it.each([
			{ mix: 100, expected: 'secondary', forbidden: 'primary' },
			{ mix: 0, expected: 'primary', forbidden: 'secondary' }
		] as const)('mix=$mix draws from the $expected bank', ({ mix, expected, forbidden }) => {
			const primary = fixtureQuoteBank();
			const secondary = fixtureSecondaryBank();
			const text = buildPassage({
				bank: primary,
				secondaryBank: secondary,
				secondaryMix: mix,
				targetLengthChars: 40
			});
			const wanted = expected === 'primary' ? primary : secondary;
			const unwanted = forbidden === 'primary' ? primary : secondary;
			expect(wanted.quotes.some((q) => text.includes(q.text))).toBe(true);
			expect(unwanted.quotes.some((q) => text.includes(q.text))).toBe(false);
		});

		it('ignores the secondary bank when secondaryMix is omitted', () => {
			const primary = fixtureQuoteBank();
			const secondary = fixtureSecondaryBank();
			const text = buildPassage({
				bank: primary,
				secondaryBank: secondary,
				targetLengthChars: 40
			});
			expect(primary.quotes.some((q) => text.includes(q.text))).toBe(true);
			expect(secondary.quotes.some((q) => text.includes(q.text))).toBe(false);
		});

		it('does not fall back to the secondary bank at mix 0, even once the primary runs dry', () => {
			// The fallback exists so an exhausted bank doesn't truncate a passage —
			// but at mix 0 the second language was never opted into, and slipping
			// French in because English ran out is worse than a short passage.
			const primary = fixtureQuoteBank();
			const secondary = fixtureSecondaryBank();
			const text = buildPassage({
				bank: primary,
				secondaryBank: secondary,
				secondaryMix: 0,
				targetLengthChars: 10_000
			});
			expect(secondary.quotes.some((q) => text.includes(q.text))).toBe(false);
		});

		it('spends the two banks independently, since ids only mean something within a bank', () => {
			// Both fixtures number their quotes from 1. One shared used-set would
			// let an English id-1 draw silently retire the French id-1.
			const primary = fixtureQuoteBank();
			const secondary = fixtureSecondaryBank();
			const text = buildPassage({
				bank: primary,
				secondaryBank: secondary,
				secondaryMix: 50,
				targetLengthChars: 10_000
			});
			for (const quote of [...primary.quotes, ...secondary.quotes]) {
				expect(text).toContain(quote.text);
			}
		});
	});

	// Both draw paths — random and debt-scored — keep their own used-set and
	// their own exhaustion handling, so each case has to run through both.
	const bothDrawPaths = [
		{ path: 'random', bigramDebts: undefined },
		{ path: 'debt-scored', bigramDebts: new Map([['ab', 10]]) }
	] as const;

	it.each(bothDrawPaths)('never repeats a quote within one passage ($path)', ({ bigramDebts }) => {
		const bank = fixtureQuoteBank();
		// Far past what three quotes can cover, so the assembler is forced to
		// either repeat or stop. It must stop.
		const text = buildPassage({ bank, targetLengthChars: 10_000, bigramDebts });
		for (const quote of bank.quotes) {
			expect(text.split(quote.text).length - 1).toBeLessThanOrEqual(1);
		}
	});
});

describe('scoreQuoteByDebt', () => {
	it('scores repayable debt per keystroke', () => {
		// "abab" holds `ab` twice and `ba` once. `ab` owes 5 but can only be paid
		// twice here; `ba` owes 1 and gets paid once. So 2 + 1 over 4 chars.
		const debts = new Map([
			['ab', 5],
			['ba', 1]
		]);
		expect(scoreQuoteByDebt('abab', debts)).toBeCloseTo(3 / 4);
	});

	it('caps credit at what the bigram actually owes', () => {
		// The `min` is the whole point: forty occurrences of a pair owing four
		// repay four. Without it, one repetitive quote would outrank everything.
		const debts = new Map([['ab', 2]]);
		const repetitive = 'ab'.repeat(20);
		expect(scoreQuoteByDebt(repetitive, debts)).toBeCloseTo(2 / repetitive.length);
	});

	it('is a density, so bulk alone does not win', () => {
		const debts = new Map([['ab', 100]]);
		const short = 'abab';
		const padded = `abab${' '.repeat(96)}`;
		expect(scoreQuoteByDebt(short, debts)).toBeGreaterThan(scoreQuoteByDebt(padded, debts));
	});

	it.each([
		['nothing owed', 'the quick brown fox', new Map<string, number>()],
		['no overlap with what is owed', 'xyz', new Map([['ab', 4]])],
		['too short to contain a bigram', 'a', new Map([['ab', 4]])],
		['empty', '', new Map([['ab', 4]])]
	])('scores zero when there is %s', (_label, text, debts) => {
		expect(scoreQuoteByDebt(text, debts)).toBe(0);
	});

	it('keeps case apart, matching how bigrams are recorded', () => {
		const debts = new Map([['Th', 4]]);
		expect(scoreQuoteByDebt('The', debts)).toBeGreaterThan(0);
		expect(scoreQuoteByDebt('the', debts)).toBe(0);
	});
});

describe('selectQuoteByDebt', () => {
	// The one branch `buildPassage` cannot reach: sampling needs an rng that
	// keeps landing on used quotes, and the frontier does not inject one.
	// Without the scan below it, a near-exhausted bank truncates the passage.
	it('scans for an unused quote when the sample keeps missing', () => {
		const bank: QuoteBank = {
			language: 'en',
			quotes: [
				{ id: 1, text: 'zzz zzz zzz', source: 't', length: 11 },
				{ id: 2, text: 'abab abab ab', source: 't', length: 12 },
				{ id: 3, text: 'qqq qqq qqq', source: 't', length: 11 }
			]
		};
		const picked = selectQuoteByDebt(bank, {
			debts: new Map([['ab', 10]]),
			used: new Set([1, 2]),
			remainingGap: 100,
			rng: () => 0
		});
		expect(picked?.id).toBe(3);
	});
});
