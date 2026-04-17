import { describe, expect, it } from 'vitest';
import { mergeCorpora } from './merge';
import { loadCorpus } from './loader';
import type { CorpusConfig } from './types';

function corpus(id: string, language: string, text: string, bigrams: Record<string, number> = {}) {
	const cfg: CorpusConfig = { id, language, wordlistId: id };
	return loadCorpus(cfg, text, bigrams);
}

describe('mergeCorpora', () => {
	it('throws on empty input', () => {
		// A zero-corpus merge is always a caller bug — don't mask it.
		expect(() => mergeCorpora([])).toThrow();
	});

	// Weight-handling sweep. Shape: two rank-1 words (so each contributes
	// 1.0 pre-scale), weights plugged into the merge, expect the resulting
	// proportion on each side. The `null` `weights` row exercises the
	// "default equal-weight" path; numeric arrays exercise normalization,
	// zero-divide fallback, and length-mismatch fallback.
	it.each`
		description             | weights     | enFreq | frFreq
		${'equal default'}      | ${null}     | ${0.5} | ${0.5}
		${'raw ratios 70 / 30'} | ${[70, 30]} | ${0.7} | ${0.3}
		${'all-zero → equal'}   | ${[0, 0]}   | ${0.5} | ${0.5}
		${'length mismatch'}    | ${[0.5]}    | ${0.5} | ${0.5}
	`(
		'weights: $description',
		({ weights, enFreq, frFreq }: { weights: number[] | null; enFreq: number; frFreq: number }) => {
			const en = corpus('en', 'en', 'one');
			const fr = corpus('fr', 'fr', 'un');
			const merged = mergeCorpora([en, fr], weights === null ? undefined : { weights });
			expect(merged.wordFrequencies['one']).toBeCloseTo(enFreq, 10);
			expect(merged.wordFrequencies['un']).toBeCloseTo(frFreq, 10);
		}
	);

	it('sums bigram frequencies across corpora, weighted', () => {
		// Shared bigram 'ab' appears in both inputs — after 50/50 merge,
		// its weight should average. Bigrams are now language-level artifacts
		// injected into the corpus, not derived from the wordlist.
		const a = corpus('a', 'en', 'ab', { ab: 1 });
		const b = corpus('b', 'fr', 'ab', { ab: 1 });
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
