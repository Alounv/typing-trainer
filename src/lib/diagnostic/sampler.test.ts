import { describe, expect, it } from 'vitest';
import { sampleDiagnosticPassage, DEFAULT_DIAGNOSTIC_CHAR_TARGET } from './sampler';
import type { CorpusData, QuoteBank } from '../corpus/types';

/**
 * Minimal synth-path corpus. We don't need the real 1000-word list — a small
 * deterministic shape exercises the fallback path when no quote bank is supplied.
 */
function fixtureCorpus(): CorpusData {
	return {
		config: { id: 'test', language: 'en', wordlistId: 'test' },
		wordFrequencies: {
			the: 100,
			and: 80,
			there: 50,
			other: 30,
			together: 25,
			brand: 20,
			hello: 10,
			world: 10,
			quiz: 5
		},
		bigramFrequencies: {
			th: 200,
			he: 180,
			an: 120,
			er: 90,
			in: 70,
			re: 60,
			ou: 40,
			nd: 30,
			or: 20,
			wo: 10
		}
	};
}

/**
 * Small quote bank for the quote-path tests. Long enough that the sampler
 * doesn't burn through the whole set at the default char target.
 */
function fixtureQuoteBank(): QuoteBank {
	return {
		language: 'en',
		groups: [[0, 1000]],
		quotes: [
			{
				id: 1,
				text: 'The quick brown fox jumps over the lazy dog near the riverbank.',
				source: 'test',
				length: 63
			},
			{
				id: 2,
				text: 'A stitch in time saves nine, but a friend in need is a friend indeed.',
				source: 'test',
				length: 69
			},
			{
				id: 3,
				text: 'The pen is mightier than the sword when wielded by a patient hand.',
				source: 'test',
				length: 66
			},
			{
				id: 4,
				text: 'Every journey of a thousand miles begins with a single careful step.',
				source: 'test',
				length: 68
			}
		]
	};
}

/** Seeded RNG: pin test sequences to stable output. */
function mulberry32(seed: number): () => number {
	let t = seed >>> 0;
	return () => {
		t = (t + 0x6d2b79f5) >>> 0;
		let r = Math.imul(t ^ (t >>> 15), 1 | t);
		r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
		return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
	};
}

describe('sampleDiagnosticPassage', () => {
	it('produces at least the target number of chars', () => {
		const passage = sampleDiagnosticPassage(fixtureCorpus(), {
			targetChars: 200,
			rng: mulberry32(1)
		});
		expect(passage.text.length).toBeGreaterThanOrEqual(200);
	});

	it('uses DEFAULT_DIAGNOSTIC_CHAR_TARGET when no target is supplied', () => {
		const passage = sampleDiagnosticPassage(fixtureCorpus(), { rng: mulberry32(2) });
		// The sampler stops after the char target is *met*, so actual length
		// is target + one trailing chunk. Assert the lower bound.
		expect(passage.text.length).toBeGreaterThanOrEqual(DEFAULT_DIAGNOSTIC_CHAR_TARGET);
	});

	it('is deterministic given a seeded RNG', () => {
		const a = sampleDiagnosticPassage(fixtureCorpus(), {
			targetChars: 150,
			rng: mulberry32(42)
		});
		const b = sampleDiagnosticPassage(fixtureCorpus(), {
			targetChars: 150,
			rng: mulberry32(42)
		});
		expect(a.text).toBe(b.text);
	});

	it('uses the quote bank when supplied — passage is assembled from real prose', () => {
		const passage = sampleDiagnosticPassage(fixtureCorpus(), {
			targetChars: 100,
			quoteBank: fixtureQuoteBank(),
			rng: mulberry32(5)
		});
		expect(passage.stats.source).toBe('quote-bank');
		// Output should contain text from at least one fixture quote.
		const quotes = fixtureQuoteBank().quotes.map((q) => q.text);
		expect(quotes.some((q) => passage.text.includes(q))).toBe(true);
	});

	it('falls back to word-synth when no quote bank is supplied', () => {
		const passage = sampleDiagnosticPassage(fixtureCorpus(), {
			targetChars: 100,
			rng: mulberry32(9)
		});
		expect(passage.stats.source).toBe('word-synth');
		expect(passage.stats.chars).toBeGreaterThan(0);
		expect(passage.stats.chunks).toBeGreaterThan(0);
	});
});
