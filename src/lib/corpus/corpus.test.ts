import { describe, expect, it } from 'vitest';
import {
	generateText,
	hasQuoteBank,
	isBuiltinCorpusId,
	loadBuiltinCorpus,
	loadQuoteBank
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
});
