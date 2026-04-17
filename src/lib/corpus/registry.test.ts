import { describe, expect, it } from 'vitest';
import {
	BUILTIN_CORPUS_IDS,
	QUOTE_BANK_LANGUAGES,
	hasQuoteBank,
	isBuiltinCorpusId,
	loadBuiltinCorpus,
	loadQuoteBank
} from './registry';

describe('isBuiltinCorpusId', () => {
	it('narrows known ids', () => {
		expect(isBuiltinCorpusId('en-top-1000')).toBe(true);
		expect(isBuiltinCorpusId('fr-top-1500')).toBe(true);
	});

	it('rejects unknown ids', () => {
		expect(isBuiltinCorpusId('en-top-999')).toBe(false);
		expect(isBuiltinCorpusId('klingon-top-1000')).toBe(false);
	});
});

describe('loadBuiltinCorpus', () => {
	it('loads en-top-1000 and derives plausible frequencies', async () => {
		const c = await loadBuiltinCorpus('en-top-1000');
		expect(c.config.id).toBe('en-top-1000');
		expect(c.config.language).toBe('en');
		// "the" is by far the most frequent English word — should be rank 1 with weight 1.
		expect(c.wordFrequencies['the']).toBe(1);
		// 1k English words yields a few hundred unique bigrams — not the 500
		// floor required of *custom* corpora, but comfortably above a toy
		// threshold that would catch "no bigrams at all" regressions.
		expect(Object.keys(c.bigramFrequencies).length).toBeGreaterThanOrEqual(100);
	});

	it('loads fr-top-1500 and keeps accented tokens intact', async () => {
		const c = await loadBuiltinCorpus('fr-top-1500');
		expect(c.config.id).toBe('fr-top-1500');
		expect(c.config.language).toBe('fr');
		// "être" is a high-frequency French verb; just check it's present at all.
		expect(c.wordFrequencies['être']).toBeDefined();
	});

	it('covers every id declared in BUILTIN_CORPUS_IDS', async () => {
		// Sanity: if an id is added to the tuple, the registry must have a loader.
		for (const id of BUILTIN_CORPUS_IDS) {
			const c = await loadBuiltinCorpus(id);
			expect(c.config.id).toBe(id);
		}
	});
});

describe('hasQuoteBank', () => {
	it('narrows to known languages', () => {
		expect(hasQuoteBank('en')).toBe(true);
		expect(hasQuoteBank('fr')).toBe(true);
	});

	it('rejects unknown languages', () => {
		expect(hasQuoteBank('de')).toBe(false);
		expect(hasQuoteBank('xx')).toBe(false);
	});
});

describe('loadQuoteBank', () => {
	it('loads English and French banks with the expected shape', async () => {
		for (const lang of QUOTE_BANK_LANGUAGES) {
			const bank = await loadQuoteBank(lang);
			expect(bank.language).toMatch(/english|french/);
			expect(bank.quotes.length).toBeGreaterThan(100);
			expect(bank.groups.length).toBeGreaterThan(0);
			// Spot-check a quote's shape.
			const q = bank.quotes[0];
			expect(typeof q.id).toBe('number');
			expect(typeof q.text).toBe('string');
			expect(typeof q.source).toBe('string');
			expect(typeof q.length).toBe('number');
		}
	});
});
