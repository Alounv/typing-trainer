import { describe, expect, it } from 'vitest';
import { BUILTIN_CORPUS_IDS, isBuiltinCorpusId, loadBuiltinCorpus } from './registry';

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
		// floor spec §6.3 requires of *custom* corpora, but comfortably above
		// a toy threshold that would catch "no bigrams at all" regressions.
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
