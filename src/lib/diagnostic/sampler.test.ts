import { describe, expect, it } from 'vitest';
import {
	sampleDiagnosticPassage,
	topBigramsByFrequency,
	DEFAULT_DIAGNOSTIC_CHAR_TARGET
} from './sampler';
import type { CorpusData } from '../corpus/types';

/**
 * Build a minimal in-memory corpus. We don't need the real 1000-word
 * list — a small deterministic shape exercises every path the sampler
 * takes (biasing, char-target loop, coverage-targets extraction).
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

describe('topBigramsByFrequency', () => {
	it('returns top-N bigrams ordered by frequency desc', () => {
		const out = topBigramsByFrequency({ ab: 10, cd: 30, ef: 20 }, 2);
		expect(out).toEqual(['cd', 'ef']);
	});

	it('breaks ties alphabetically so output is deterministic', () => {
		const out = topBigramsByFrequency({ zz: 10, aa: 10, mm: 10 }, 3);
		expect(out).toEqual(['aa', 'mm', 'zz']);
	});

	it('count larger than table returns everything', () => {
		const out = topBigramsByFrequency({ ab: 1, cd: 2 }, 50);
		expect(out).toHaveLength(2);
	});

	it('empty table → empty output', () => {
		expect(topBigramsByFrequency({}, 10)).toEqual([]);
	});
});

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
		// The sampler stops after the char target is *met*, so actual
		// length is target + one trailing sentence. Assert the lower bound.
		expect(passage.text.length).toBeGreaterThanOrEqual(DEFAULT_DIAGNOSTIC_CHAR_TARGET);
	});

	it('reports the coverage targets it biased toward', () => {
		const passage = sampleDiagnosticPassage(fixtureCorpus(), {
			targetChars: 100,
			coverageTopN: 3,
			rng: mulberry32(3)
		});
		// Top 3 by frequency: th=200, he=180, an=120
		expect(passage.coverageTargets).toEqual(['th', 'he', 'an']);
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

	it('biases output toward top bigrams (best-effort coverage)', () => {
		// With target bigrams biased 5× harder (TARGET_BOOST in selection.ts),
		// words containing them should dominate. The fixture stacks the
		// wordlist with bigram-rich words: "the", "there", "together" all
		// contain "th" & "he". Count "th" occurrences; it should appear
		// more often than non-target "wo".
		const passage = sampleDiagnosticPassage(fixtureCorpus(), {
			targetChars: 500,
			coverageTopN: 3,
			rng: mulberry32(7)
		});
		const thCount = (passage.text.match(/th/g) ?? []).length;
		const woCount = (passage.text.match(/wo/g) ?? []).length;
		expect(thCount).toBeGreaterThan(woCount);
	});

	it('exposes source metadata from the underlying generator', () => {
		const passage = sampleDiagnosticPassage(fixtureCorpus(), {
			targetChars: 100,
			rng: mulberry32(9)
		});
		expect(passage.stats.source).toBe('word-synth');
		expect(passage.stats.chars).toBeGreaterThan(0);
		expect(passage.stats.chunks).toBeGreaterThan(0);
	});
});
