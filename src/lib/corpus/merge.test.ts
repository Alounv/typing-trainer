import { describe, expect, it } from 'vitest';
import { mergeCorpora } from './merge';
import { loadCorpus } from './loader';
import type { CorpusConfig } from './types';

function corpus(id: string, language: string, text: string) {
	const cfg: CorpusConfig = { id, language, wordlistId: id };
	return loadCorpus(cfg, text);
}

describe('mergeCorpora', () => {
	it('throws on empty input', () => {
		// A zero-corpus merge is always a caller bug — don't mask it.
		expect(() => mergeCorpora([])).toThrow();
	});

	it('equal-weight default when weights not supplied', () => {
		const en = corpus('en', 'en', 'the of');
		const fr = corpus('fr', 'fr', 'le de');
		const merged = mergeCorpora([en, fr]);
		// Equal weight = 0.5 each. `the` has rank-1 weight 1 in EN → 0.5 after merge.
		expect(merged.wordFrequencies['the']).toBeCloseTo(0.5, 10);
		expect(merged.wordFrequencies['le']).toBeCloseTo(0.5, 10);
	});

	it('normalizes raw ratio weights: [70, 30] → 0.7/0.3', () => {
		const en = corpus('en', 'en', 'one');
		const fr = corpus('fr', 'fr', 'un');
		const merged = mergeCorpora([en, fr], { weights: [70, 30] });
		expect(merged.wordFrequencies['one']).toBeCloseTo(0.7, 10);
		expect(merged.wordFrequencies['un']).toBeCloseTo(0.3, 10);
	});

	it('treats all-zero weights as equal weight', () => {
		// Safety valve — don't divide-by-zero into NaN-land.
		const en = corpus('en', 'en', 'one');
		const fr = corpus('fr', 'fr', 'un');
		const merged = mergeCorpora([en, fr], { weights: [0, 0] });
		expect(merged.wordFrequencies['one']).toBeCloseTo(0.5, 10);
	});

	it('falls back to equal weight on length mismatch', () => {
		const en = corpus('en', 'en', 'one');
		const fr = corpus('fr', 'fr', 'un');
		const merged = mergeCorpora([en, fr], { weights: [0.5] });
		expect(merged.wordFrequencies['one']).toBeCloseTo(0.5, 10);
	});

	it('sums bigram frequencies across corpora, weighted', () => {
		// Shared bigram 'ab' appears in both inputs — after 50/50 merge,
		// its weight should be (en_weight × en_freq) + (fr_weight × fr_freq).
		const a = corpus('a', 'en', 'ab'); // bigram 'ab' → 1 (rank 1)
		const b = corpus('b', 'fr', 'ab'); // bigram 'ab' → 1 (rank 1)
		const merged = mergeCorpora([a, b]);
		expect(merged.bigramFrequencies['ab']).toBeCloseTo(1.0, 10);
	});

	it('merged config.language joins participating languages', () => {
		const en = corpus('en', 'en', 'x');
		const fr = corpus('fr', 'fr', 'y');
		const merged = mergeCorpora([en, fr]);
		expect(merged.config.language).toBe('en-fr');
	});

	it('single-corpus merge rewraps with the merged id', () => {
		const c = corpus('en', 'en', 'one two');
		const merged = mergeCorpora([c], { mergedId: 'only-en' });
		expect(merged.config.id).toBe('only-en');
		expect(merged.wordFrequencies).toEqual(c.wordFrequencies);
	});

	it('skips zero-weighted corpora entirely (no accidental contribution)', () => {
		const en = corpus('en', 'en', 'one');
		const fr = corpus('fr', 'fr', 'un');
		const merged = mergeCorpora([en, fr], { weights: [1, 0] });
		expect(merged.wordFrequencies['one']).toBeCloseTo(1, 10);
		expect(merged.wordFrequencies['un']).toBeUndefined();
	});
});
