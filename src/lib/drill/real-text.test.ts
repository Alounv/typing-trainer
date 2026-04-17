import { describe, expect, it } from 'vitest';
import { generateRealTextSequence } from './real-text';
import { loadCorpus } from '../corpus/loader';
import type { CorpusConfig, Quote, QuoteBank } from '../corpus/types';

const CORPUS_CONFIG: CorpusConfig = { id: 'test', language: 'en', wordlistId: 'test' };

function quote(id: number, text: string): Quote {
	return { id, text, source: `src-${id}`, length: text.length };
}

function bank(quotes: Quote[]): QuoteBank {
	return {
		language: 'test',
		groups: [
			[0, 100],
			[101, 300]
		],
		quotes
	};
}

function corpus(words: string) {
	return loadCorpus(CORPUS_CONFIG, words);
}

describe('generateRealTextSequence', () => {
	it('throws when neither quoteBank nor fallbackCorpus is supplied', () => {
		// Programming bug — loud failure.
		expect(() => generateRealTextSequence({})).toThrow();
	});

	it('uses the quote bank when available', () => {
		const qb = bank([quote(1, 'first quote'), quote(2, 'second quote'), quote(3, 'third quote')]);
		const out = generateRealTextSequence({
			quoteBank: qb,
			options: { targetLengthChars: 20, rng: () => 0 }
		});
		expect(out.stats.source).toBe('quote-bank');
		expect(out.segments.every((s) => s.kind === 'quote')).toBe(true);
	});

	it('does not repeat a quote id within a single call', () => {
		const qb = bank([quote(1, 'a'), quote(2, 'b'), quote(3, 'c')]);
		const out = generateRealTextSequence({
			quoteBank: qb,
			// Ask for way more text than the bank holds so the no-repeat invariant is
			// under real pressure. `maxChunks` caps the loop.
			options: { targetLengthChars: 9999, maxChunks: 10, rng: () => 0 }
		});
		const ids = out.segments.map((s) => s.kind === 'quote' && s.quote.id).filter(Boolean);
		expect(new Set(ids).size).toBe(ids.length);
		// Only 3 quotes exist, so we can't exceed that even though target is huge.
		expect(ids.length).toBeLessThanOrEqual(3);
	});

	it('falls back to synth sentences when quote bank exhausted and corpus supplied', () => {
		// Tiny bank (one quote) + big target length + fallback corpus →
		// bank runs out, synth kicks in.
		const qb = bank([quote(1, 'just one short quote')]);
		const c = corpus('the of and a to in that is it for on');
		const out = generateRealTextSequence({
			quoteBank: qb,
			fallbackCorpus: c,
			options: { targetLengthChars: 200, maxChunks: 20, rng: () => 0 }
		});
		expect(out.stats.source).toBe('quote-bank-exhausted');
		expect(out.segments.some((s) => s.kind === 'quote')).toBe(true);
		expect(out.segments.some((s) => s.kind === 'synth')).toBe(true);
	});

	it('uses word-synth fallback when no quote bank supplied', () => {
		const c = corpus('the of and a to in');
		const out = generateRealTextSequence({
			fallbackCorpus: c,
			options: { targetLengthChars: 60, rng: () => 0 }
		});
		expect(out.stats.source).toBe('word-synth');
		expect(out.segments.every((s) => s.kind === 'synth')).toBe(true);
	});

	it('concatenates segment texts with the two-space separator', () => {
		const qb = bank([quote(1, 'aa'), quote(2, 'bb')]);
		const out = generateRealTextSequence({
			quoteBank: qb,
			options: { targetLengthChars: 3, rng: () => 0 }
		});
		// With target 3 and quote 'aa' (2 chars) first, we keep going until
		// ≥3 chars → picks a 2nd quote. Final text = "aa" + "  " + "bb".
		expect(out.text).toBe('aa  bb');
	});

	it('stops at maxChunks even if the target length is not met', () => {
		const qb = bank([quote(1, 'a'), quote(2, 'b'), quote(3, 'c')]);
		const out = generateRealTextSequence({
			quoteBank: qb,
			options: { targetLengthChars: 9999, maxChunks: 2, rng: () => 0 }
		});
		expect(out.segments).toHaveLength(2);
	});

	it('respects quoteLengthGroup filter', () => {
		const qb = bank([
			quote(1, 'short'), // 5
			quote(2, 'medium-ish text here') // 20
		]);
		const out = generateRealTextSequence({
			quoteBank: qb,
			options: { quoteLengthGroup: [0, 10], targetLengthChars: 5, rng: () => 0 }
		});
		// Only quote id 1 fits the [0, 10] filter.
		expect(out.segments[0]).toMatchObject({ kind: 'quote' });
		if (out.segments[0].kind === 'quote') {
			expect(out.segments[0].quote.id).toBe(1);
		}
	});
});
