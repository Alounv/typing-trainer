import { describe, expect, it } from 'vitest';
import { importCustomText, MIN_CUSTOM_BIGRAMS } from './custom';
import { loadCorpus } from './loader';

describe('importCustomText', () => {
	it('tokenizes lowercased letter sequences', () => {
		const { data } = importCustomText('Hello, WORLD! hello.');
		expect(data.wordFrequencies['hello']).toBe(2);
		expect(data.wordFrequencies['world']).toBe(1);
		expect(data.wordFrequencies[',']).toBeUndefined();
	});

	it('keeps internal apostrophes as part of a single word', () => {
		// French "d'abord" is one typing-practice unit, not two.
		const { data } = importCustomText("d'abord aujourd'hui");
		expect(data.wordFrequencies["d'abord"]).toBe(1);
		expect(data.wordFrequencies["aujourd'hui"]).toBe(1);
	});

	it('tokenCount reflects actual token count, not whitespace-split count', () => {
		const { stats } = importCustomText('one, two, three; four!');
		expect(stats.tokenCount).toBe(4);
	});

	it('handles Unicode letters (French accents)', () => {
		const { data } = importCustomText('fête déjà');
		expect(data.wordFrequencies['fête']).toBe(1);
		expect(data.wordFrequencies['déjà']).toBe(1);
	});

	it('derives bigrams from the counted words', () => {
		// "hello" has pairs: he, el, ll, lo. Count = 2, so each bigram weight = 2.
		const { data } = importCustomText('hello hello');
		expect(data.bigramFrequencies['he']).toBe(2);
		expect(data.bigramFrequencies['ll']).toBe(2);
	});

	it('flags tooSmall when uniqueBigramCount < spec floor (500)', () => {
		const { stats } = importCustomText('the quick brown fox');
		expect(stats.tooSmall).toBe(true);
		expect(MIN_CUSTOM_BIGRAMS).toBe(500);
	});

	it('customText survives on the resulting config', () => {
		const text = 'hello world';
		const { data } = importCustomText(text);
		expect(data.config.customText).toBe(text);
	});

	it('reports missingFromBase bigrams when a base corpus is passed', () => {
		// Base has bigrams 'th' and 'he'; custom has only 'he'. Missing: 'th'.
		const base = loadCorpus({ id: 'base', language: 'en', wordlistId: 'base' }, 'the');
		const { missingFromBase } = importCustomText('he he', { baseForOverlap: base });
		expect(missingFromBase).toContain('th');
		expect(missingFromBase).not.toContain('he');
	});

	it('missingFromBase is undefined when no base corpus supplied', () => {
		const { missingFromBase } = importCustomText('hello');
		expect(missingFromBase).toBeUndefined();
	});
});
