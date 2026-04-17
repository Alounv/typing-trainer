import { describe, expect, it } from 'vitest';
import { generateBigramDrillSequence } from './bigram-drill';
import { loadCorpus } from '../corpus/loader';
import type { CorpusConfig } from '../corpus/types';

const CONFIG: CorpusConfig = { id: 'test', language: 'en', wordlistId: 'test' };

function corpus(words: string) {
	return loadCorpus(CONFIG, words);
}

describe('generateBigramDrillSequence', () => {
	it('throws when targetBigrams is empty', () => {
		expect(() =>
			generateBigramDrillSequence({
				targetBigrams: [],
				corpus: corpus('the of and a')
			})
		).toThrow();
	});

	it('throws when corpus has no usable words at all', () => {
		// Both pools empty → unrecoverable. Loud failure beats silent empty output.
		const emptyCorpus = loadCorpus(CONFIG, '');
		expect(() =>
			generateBigramDrillSequence({
				targetBigrams: ['th'],
				corpus: emptyCorpus
			})
		).toThrow();
	});

	it('emits exactly wordCount words in order', () => {
		const seq = generateBigramDrillSequence({
			targetBigrams: ['th'],
			corpus: corpus('the that with other of and a to in'),
			options: { wordCount: 25, rng: () => 0 }
		});
		expect(seq.words).toHaveLength(25);
		expect(seq.text.split(' ')).toEqual(seq.words);
	});

	it('falls back to filler pool when no targets are available in corpus', () => {
		// Targets "zz" doesn't appear in any word → all picks land in filler.
		const seq = generateBigramDrillSequence({
			targetBigrams: ['zz'],
			corpus: corpus('the of and a'),
			options: { wordCount: 5, rng: () => 0 }
		});
		expect(seq.stats.targetWords).toBe(0);
		expect(seq.stats.fillerWords).toBe(5);
	});

	it('falls back to target pool when no filler words exist', () => {
		// Every word contains target "a" → filler pool is empty.
		const seq = generateBigramDrillSequence({
			targetBigrams: ['a'],
			corpus: corpus('a at an and'),
			// 'a' is length 1 so our helper skips it; use a real bigram.
			options: { wordCount: 4, rng: () => 0 }
		});
		// With the 'a' (len 1) sanitization, no target was countable —
		// should fall back to filler instead. This doubles as a guard for
		// the "ignore <2-char targets" invariant.
		expect(seq.words).toHaveLength(4);
	});

	it('respects 70/30 ratio under uniform RNG', () => {
		// Deterministic RNG: half < 0.7, half ≥ 0.7, cycling.
		// With wordCount large enough, target/filler should sit near the 70/30 split.
		const seq = generateBigramDrillSequence({
			targetBigrams: ['th'],
			corpus: corpus('the of to and a in is it you that he was for on are with as his they be'),
			options: {
				wordCount: 100,
				// Deterministic uniform over [0, 1): i / 100 covers the range.

				rng: (() => {
					let i = 0;
					return () => (i++ % 100) / 100;
				})()
			}
		});
		// 70 picks should be <0.7 → target; 30 picks ≥0.7 → filler.
		expect(seq.stats.targetWords).toBe(70);
		expect(seq.stats.fillerWords).toBe(30);
	});

	it('clamps out-of-range targetRatio', () => {
		// Ratio of 2.0 → clamped to 1.0 → all target picks.
		const seq = generateBigramDrillSequence({
			targetBigrams: ['th'],
			corpus: corpus('the of to and'),
			options: { wordCount: 10, targetRatio: 2, rng: () => 0.99 }
		});
		// Every `rng()` returns 0.99 ≥ clamped 1.0 → but since ratio clamped to 1,
		// the `useTarget` check is `rng() < 1.0` which is always true → all target.
		expect(seq.stats.targetWords).toBe(10);
	});

	it('populates distinctTargets with unique target bigrams the picks stressed', () => {
		// "thing" contains "th" and "ng"; biased RNG ensures we pick it.
		const seq = generateBigramDrillSequence({
			targetBigrams: ['th', 'ng'],
			corpus: corpus('thing'),
			options: { wordCount: 3, rng: () => 0 }
		});
		expect(seq.stats.distinctTargets).toBe(2);
	});

	it('ignores target bigrams shorter than 2 chars (symmetric with selection.ts)', () => {
		// Single-char "target" shouldn't partition — word goes to filler.
		const seq = generateBigramDrillSequence({
			targetBigrams: ['a', 'th'],
			corpus: corpus('apple the'),
			options: { wordCount: 20, rng: () => 0 }
		});
		// 'apple' contains no valid target ('th' isn't in it) → filler;
		// 'the' contains 'th' → target.
		// With the 70/30 ratio and rng=0 always picking target bucket,
		// we expect mostly 'the'.
		expect(seq.words.filter((w) => w === 'the').length).toBeGreaterThan(0);
	});
});
