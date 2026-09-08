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
import type { CorpusData, QuoteBank } from './types';

function fixtureCorpus(): CorpusData {
	return {
		config: { id: 'test', language: 'en', wordlistId: 'test' },
		wordFrequencies: {
			the: 100,
			and: 80,
			there: 50,
			other: 30,
			together: 25,
			of: 20,
			to: 18,
			in: 15,
			that: 12,
			is: 10
		},
		bigramFrequencies: { th: 200, he: 180, an: 120, er: 90, in: 70, re: 60 }
	};
}

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
	it('bigram-drill: produces a non-empty word sequence drawn from the corpus', () => {
		const { text } = generateText({
			kind: 'bigram-drill',
			corpus: fixtureCorpus(),
			targetBigrams: ['th'],
			wordCount: 20
		});
		const words = text.split(' ');
		expect(words).toHaveLength(20);
		// 100%-target-bearing contract: every picked word must contain 'th'.
		expect(words.every((w) => w.includes('th'))).toBe(true);
	});

	it('bigram-drill: throws when the corpus has no usable words', () => {
		const empty: CorpusData = {
			config: { id: 'x', language: 'en', wordlistId: 'x' },
			wordFrequencies: {},
			bigramFrequencies: {}
		};
		expect(() =>
			generateText({ kind: 'bigram-drill', corpus: empty, targetBigrams: ['th'], wordCount: 5 })
		).toThrow();
	});

	it('real-text: uses quotes from the bank when supplied', () => {
		const bank = fixtureQuoteBank();
		const { text } = generateText({
			kind: 'real-text',
			corpus: fixtureCorpus(),
			quoteBank: bank,
			targetLengthChars: 40
		});
		// The output must reproduce at least one quote's text verbatim — we don't
		// care which, just that the bank is being used as the source.
		expect(bank.quotes.some((q) => text.includes(q.text))).toBe(true);
	});

	it('real-text: falls back to word-synth when no quote bank is available', () => {
		const { text } = generateText({
			kind: 'real-text',
			corpus: fixtureCorpus(),
			quoteBank: undefined,
			targetLengthChars: 60
		});
		expect(text.length).toBeGreaterThanOrEqual(60);
		// Every word in the synth output should be from the fixture corpus.
		const corpusWords = new Set(Object.keys(fixtureCorpus().wordFrequencies));
		for (const w of text.split(' ')) {
			expect(corpusWords.has(w)).toBe(true);
		}
	});

	it('diagnostic: meets the requested char target', () => {
		const { text } = generateText({
			kind: 'diagnostic',
			corpus: fixtureCorpus(),
			quoteBank: undefined,
			targetChars: 150
		});
		expect(text.length).toBeGreaterThanOrEqual(150);
	});

	it('diagnostic: assembles from the quote bank when supplied', () => {
		const bank = fixtureQuoteBank();
		const { text } = generateText({
			kind: 'diagnostic',
			corpus: fixtureCorpus(),
			quoteBank: bank,
			targetChars: 100
		});
		expect(bank.quotes.some((q) => text.includes(q.text))).toBe(true);
	});

	// `rng() * 100 < secondaryMix` is deterministic at 0 (always primary) and at
	// 100 (always secondary, since Math.random < 1) — no RNG injection needed.
	describe('real-text language mix', () => {
		it.each([
			{ mix: 100, expected: 'secondary', forbidden: 'primary' },
			{ mix: 0, expected: 'primary', forbidden: 'secondary' }
		] as const)('mix=$mix draws from the $expected bank', ({ mix, expected, forbidden }) => {
			const primary = fixtureQuoteBank();
			const secondary = fixtureSecondaryBank();
			const { text } = generateText({
				kind: 'real-text',
				corpus: fixtureCorpus(),
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
				kind: 'real-text',
				corpus: fixtureCorpus(),
				quoteBank: primary,
				secondaryQuoteBank: secondary,
				targetLengthChars: 40
			});
			expect(primary.quotes.some((q) => text.includes(q.text))).toBe(true);
			expect(secondary.quotes.some((q) => text.includes(q.text))).toBe(false);
		});
	});

	// Targets always come from primary; only the word pool swaps per draw.
	describe('bigram-drill language mix', () => {
		const secondaryCorpus: CorpusData = {
			config: { id: 'fr', language: 'fr', wordlistId: 'fr' },
			wordFrequencies: {
				methode: 100, // "th" — target-bearing
				ethique: 80, // "th" — target-bearing
				bonjour: 50,
				maison: 40,
				travail: 30
			},
			bigramFrequencies: { th: 30, et: 80, ai: 100 }
		};

		it('mix=100 draws drill words from the secondary corpus when it has target-bearing words', () => {
			const { text } = generateText({
				kind: 'bigram-drill',
				corpus: fixtureCorpus(),
				secondaryCorpus,
				secondaryMix: 100,
				targetBigrams: ['th'],
				wordCount: 10
			});
			const words = text.split(' ');
			const secondaryWords = new Set(Object.keys(secondaryCorpus.wordFrequencies));
			expect(words.every((w) => w.includes('th'))).toBe(true);
			expect(words.every((w) => secondaryWords.has(w))).toBe(true);
		});

		it('partial mix lays out primary first, then secondary as a contiguous block', () => {
			// mix=30 of 10 words → 7 primary, 3 secondary, in that order.
			const { text } = generateText({
				kind: 'bigram-drill',
				corpus: fixtureCorpus(),
				secondaryCorpus,
				secondaryMix: 30,
				targetBigrams: ['th'],
				wordCount: 10
			});
			const words = text.split(' ');
			const primaryWords = new Set(Object.keys(fixtureCorpus().wordFrequencies));
			const secondaryWords = new Set(Object.keys(secondaryCorpus.wordFrequencies));
			expect(words.slice(0, 7).every((w) => primaryWords.has(w))).toBe(true);
			expect(words.slice(7).every((w) => secondaryWords.has(w))).toBe(true);
		});

		it('falls back to primary when secondary has no target-bearing words for the target', () => {
			// "zz" matches neither corpus → mix inactive → primary-only.
			const primary: CorpusData = {
				...fixtureCorpus(),
				wordFrequencies: { ...fixtureCorpus().wordFrequencies, buzz: 5 }
			};
			const { text } = generateText({
				kind: 'bigram-drill',
				corpus: primary,
				secondaryCorpus,
				secondaryMix: 100,
				targetBigrams: ['zz'],
				wordCount: 10
			});
			const words = text.split(' ');
			const primaryWords = new Set(Object.keys(primary.wordFrequencies));
			expect(words.every((w) => primaryWords.has(w))).toBe(true);
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
