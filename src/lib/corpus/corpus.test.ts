import { describe, expect, it } from 'vitest';
import {
	generateText,
	hasQuoteBank,
	isBuiltinCorpusId,
	loadBuiltinCorpus,
	loadQuoteBank,
	scoreQuoteByDebt,
	selectQuoteByDebt
} from './index';
import type { QuoteBank } from './types';

function fixtureQuoteBank(): QuoteBank {
	return {
		language: 'en',
		groups: [[0, 1000]],
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
		groups: [[0, 1000]],
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
	it('narrows ids that ship as built-in corpora', () => {
		expect(isBuiltinCorpusId('en')).toBe(true);
		expect(isBuiltinCorpusId('fr')).toBe(true);
		expect(isBuiltinCorpusId('klingon')).toBe(false);
	});

	it('narrows languages that ship a quote bank', () => {
		expect(hasQuoteBank('en')).toBe(true);
		expect(hasQuoteBank('de')).toBe(false);
	});

	it('loads en with its word frequencies and bigram table', async () => {
		const c = await loadBuiltinCorpus('en');
		expect(c.config.language).toBe('en');
		expect(c.wordFrequencies['the']).toBeDefined();
		expect(Object.keys(c.bigramFrequencies).length).toBeGreaterThanOrEqual(100);
	});

	it('populates word-boundary bigrams on the same scale as interior bigrams', async () => {
		const c = await loadBuiltinCorpus('en');
		// "the" is the top word → " t" and "e " should beat the corpus floor by orders of
		// magnitude; otherwise priority drills bury them (assessment.ts:127).
		expect(c.bigramFrequencies[' t']).toBeGreaterThan(0);
		expect(c.bigramFrequencies['e ']).toBeGreaterThan(0);
		const interiorTop = c.bigramFrequencies['th'];
		expect(c.bigramFrequencies[' t']).toBeGreaterThan(interiorTop / 100);
	});

	it('loads the en quote bank with quotes and length groups', async () => {
		const bank = await loadQuoteBank('en');
		expect(bank.quotes.length).toBeGreaterThan(50);
		expect(bank.groups.length).toBeGreaterThan(0);
	});
});

describe('generateText', () => {
	it('assembles the passage from the bank verbatim', () => {
		const bank = fixtureQuoteBank();
		const { text } = generateText({ quoteBank: bank, targetLengthChars: 40 });
		// The output must reproduce at least one quote's text verbatim — we don't
		// care which, just that real prose is the source and nothing rewrites it.
		expect(bank.quotes.some((q) => text.includes(q.text))).toBe(true);
	});

	it('prefers quotes that repay debt', () => {
		const bank: QuoteBank = {
			language: 'en',
			groups: [[0, 1000]],
			quotes: [
				{ id: 1, text: 'zzz zzz zzz zzz zzz zzz.', source: 't', length: 24 },
				{ id: 2, text: 'abab abab abab abab abab.', source: 't', length: 25 }
			]
		};
		const { text } = generateText({
			quoteBank: bank,
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
			const { text } = generateText({
				quoteBank: primary,
				secondaryQuoteBank: secondary,
				secondaryMix: mix,
				targetLengthChars: 40
			});
			const wanted = expected === 'primary' ? primary : secondary;
			const unwanted = forbidden === 'primary' ? primary : secondary;
			expect(wanted.quotes.some((q) => text.includes(q.text))).toBe(true);
			expect(unwanted.quotes.some((q) => text.includes(q.text))).toBe(false);
		});

		it('ignores secondary bank when secondaryMix is omitted', () => {
			const primary = fixtureQuoteBank();
			const secondary = fixtureSecondaryBank();
			const { text } = generateText({
				quoteBank: primary,
				secondaryQuoteBank: secondary,
				targetLengthChars: 40
			});
			expect(primary.quotes.some((q) => text.includes(q.text))).toBe(true);
			expect(secondary.quotes.some((q) => text.includes(q.text))).toBe(false);
		});
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
	const bank: QuoteBank = {
		language: 'en',
		groups: [[0, 1000]],
		quotes: [
			{ id: 1, text: 'zzz zzz zzz', source: 't', length: 11 },
			{ id: 2, text: 'abab abab ab', source: 't', length: 12 },
			{ id: 3, text: 'qqq qqq qqq', source: 't', length: 11 }
		]
	};

	/** Walks the bank in order and repeats, so every quote gets sampled. */
	function cyclingRng(): () => number {
		let i = 0;
		return () => (i++ % bank.quotes.length) / bank.quotes.length;
	}

	it('picks the quote that repays the most per keystroke', () => {
		const debts = new Map([['ab', 10]]);
		const picked = selectQuoteByDebt(bank, {
			debts,
			used: new Set(),
			remainingGap: 100,
			rng: cyclingRng()
		});
		expect(picked?.id).toBe(2);
	});

	it('never returns a quote already used in this passage', () => {
		const debts = new Map([['ab', 10]]);
		const picked = selectQuoteByDebt(bank, {
			debts,
			used: new Set([2]),
			remainingGap: 100,
			rng: cyclingRng()
		});
		expect(picked?.id).not.toBe(2);
	});

	it('returns an overshooting quote rather than nothing', () => {
		// A tiny remaining gap must not starve the passage — better one quote too
		// long than a session that cannot be built.
		const picked = selectQuoteByDebt(bank, {
			debts: new Map([['ab', 10]]),
			used: new Set(),
			remainingGap: 1,
			rng: cyclingRng()
		});
		expect(picked).not.toBeNull();
	});

	it('returns null only when every quote is used', () => {
		const picked = selectQuoteByDebt(bank, {
			debts: new Map([['ab', 10]]),
			used: new Set([1, 2, 3]),
			remainingGap: 100,
			rng: cyclingRng()
		});
		expect(picked).toBeNull();
	});

	it('finds an unused quote the sample missed', () => {
		// A near-exhausted bank with an rng that keeps landing on used quotes:
		// the linear scan is what keeps the passage buildable.
		const picked = selectQuoteByDebt(bank, {
			debts: new Map([['ab', 10]]),
			used: new Set([1, 2]),
			remainingGap: 100,
			rng: () => 0
		});
		expect(picked?.id).toBe(3);
	});
});
