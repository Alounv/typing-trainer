import { describe, expect, it } from 'vitest';
import { deriveBigramFrequencies, loadCorpus } from './loader';
import type { CorpusConfig } from './types';

const CONFIG: CorpusConfig = { id: 'test', language: 'en', wordlistId: 'test' };

describe('loadCorpus', () => {
	it('splits a whitespace-separated raw string into ordered words', () => {
		const c = loadCorpus(CONFIG, 'the of to and a');
		expect(Object.keys(c.wordFrequencies)).toEqual(['the', 'of', 'to', 'and', 'a']);
	});

	it('assigns Zipf frequencies: rank-1 > rank-2 > rank-3, ratio 1:0.5:0.333…', () => {
		const c = loadCorpus(CONFIG, 'one two three');
		expect(c.wordFrequencies['one']).toBe(1);
		expect(c.wordFrequencies['two']).toBe(0.5);
		expect(c.wordFrequencies['three']).toBeCloseTo(1 / 3, 10);
	});

	it('collapses duplicates — first position wins', () => {
		const c = loadCorpus(CONFIG, 'the of the and the');
		// 'the' appears at rank 1, later occurrences ignored.
		expect(c.wordFrequencies['the']).toBe(1);
		expect(c.wordFrequencies['of']).toBe(0.5);
		expect(c.wordFrequencies['and']).toBeCloseTo(1 / 3, 10);
		// Total unique words = 3, not 5.
		expect(Object.keys(c.wordFrequencies)).toHaveLength(3);
	});

	it('tolerates multiple-whitespace and leading/trailing space', () => {
		const c = loadCorpus(CONFIG, '   the   of \n to   ');
		expect(Object.keys(c.wordFrequencies)).toEqual(['the', 'of', 'to']);
	});

	it('ignores single-char words for bigrams but keeps them in wordFrequencies', () => {
		const c = loadCorpus(CONFIG, 'a bb ccc');
		expect(c.wordFrequencies['a']).toBe(1);
		// Only 'bb' (bigram 'bb') and 'ccc' (bigrams 'cc', 'cc' → one unique) contribute.
		expect(c.bigramFrequencies['bb']).toBeCloseTo(0.5, 10);
		expect(c.bigramFrequencies['cc']).toBeCloseTo((1 / 3) * 2, 10); // 'ccc' has two 'cc' pairs.
	});

	it('bigram weight accumulates the word frequency across adjacent pairs', () => {
		// 'aaa' → pairs 'aa', 'aa'. Word freq = 1 (rank 1). Bigram weight = 2.
		const c = loadCorpus(CONFIG, 'aaa');
		expect(c.bigramFrequencies['aa']).toBe(2);
	});

	it('passes config through unchanged', () => {
		const cfg: CorpusConfig = { id: 'en-100', language: 'en', wordlistId: 'en-100' };
		const c = loadCorpus(cfg, 'hello');
		expect(c.config).toBe(cfg);
	});
});

describe('deriveBigramFrequencies', () => {
	it('returns empty table for empty input', () => {
		expect(deriveBigramFrequencies({})).toEqual({});
	});

	it('weights bigrams by the owning word freq', () => {
		// Two words, different weights. 'ab' appears in both, so its
		// bigram weight should be the sum of the two word weights.
		const out = deriveBigramFrequencies({ abc: 2, ab: 10 });
		expect(out['ab']).toBe(2 + 10);
		expect(out['bc']).toBe(2);
	});
});
