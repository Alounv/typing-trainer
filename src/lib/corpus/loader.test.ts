import { describe, expect, it } from 'vitest';
import { loadCorpus } from './loader';
import type { CorpusConfig, FrequencyTable } from './types';

const CONFIG: CorpusConfig = { id: 'test', language: 'en', wordlistId: 'test' };

// Synthetic bigram table for unit tests. Production uses `data/*-bigrams.json`.
const BIGRAMS: FrequencyTable = { ab: 0.5, cd: 0.3, ef: 0.2 };

describe('loadCorpus', () => {
	it('splits a whitespace-separated raw string into ordered words', () => {
		const c = loadCorpus(CONFIG, 'the of to and a', BIGRAMS);
		expect(Object.keys(c.wordFrequencies)).toEqual(['the', 'of', 'to', 'and', 'a']);
	});

	it('assigns Zipf frequencies: rank-1 > rank-2 > rank-3, ratio 1:0.5:0.333…', () => {
		const c = loadCorpus(CONFIG, 'one two three', BIGRAMS);
		expect(c.wordFrequencies['one']).toBe(1);
		expect(c.wordFrequencies['two']).toBe(0.5);
		expect(c.wordFrequencies['three']).toBeCloseTo(1 / 3, 10);
	});

	it('collapses duplicates — first position wins', () => {
		const c = loadCorpus(CONFIG, 'the of the and the', BIGRAMS);
		// 'the' appears at rank 1, later occurrences ignored.
		expect(c.wordFrequencies['the']).toBe(1);
		expect(c.wordFrequencies['of']).toBe(0.5);
		expect(c.wordFrequencies['and']).toBeCloseTo(1 / 3, 10);
		// Total unique words = 3, not 5.
		expect(Object.keys(c.wordFrequencies)).toHaveLength(3);
	});

	it('tolerates multiple-whitespace and leading/trailing space', () => {
		const c = loadCorpus(CONFIG, '   the   of \n to   ', BIGRAMS);
		expect(Object.keys(c.wordFrequencies)).toEqual(['the', 'of', 'to']);
	});

	it('passes bigramFrequencies through verbatim', () => {
		// Bigram distribution is a language-level artifact (shipped in `data/*-bigrams.json`)
		// — the loader just wires it onto the `CorpusData`, same reference in and out.
		const c = loadCorpus(CONFIG, 'hello world', BIGRAMS);
		expect(c.bigramFrequencies).toBe(BIGRAMS);
	});

	it('passes config through unchanged', () => {
		const cfg: CorpusConfig = { id: 'en-100', language: 'en', wordlistId: 'en-100' };
		const c = loadCorpus(cfg, 'hello', BIGRAMS);
		expect(c.config).toBe(cfg);
	});
});
