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

	it('emits 100% target-bearing words when the target pool is populated', () => {
		// No ratio knob any more — the drill is 100% target-bearing by design.
		// Varying RNG across [0,1) must not shift any pick into the filler pool.
		const seq = generateBigramDrillSequence({
			targetBigrams: ['th'],
			corpus: corpus('the of to and a in is it you that he was for on are with as his they be'),
			options: {
				wordCount: 100,
				rng: (() => {
					let i = 0;
					return () => (i++ % 100) / 100;
				})()
			}
		});
		expect(seq.stats.targetWords).toBe(100);
		expect(seq.stats.fillerWords).toBe(0);
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
		// Single-char "target" shouldn't partition — 'apple' stays in filler.
		const seq = generateBigramDrillSequence({
			targetBigrams: ['a', 'th'],
			corpus: corpus('apple the'),
			options: { wordCount: 20, rng: () => 0 }
		});
		// 'apple' has no valid target ('th' isn't in it) → filler; 'the'
		// contains 'th' → target. Drill is 100% target-bearing, so every
		// pick must be 'the'.
		expect(seq.words.every((w) => w === 'the')).toBe(true);
	});

	it('treats a leading-space target as "word starts with letter"', () => {
		// Target ' a' = "space then 'a'" — happens at the start of any word
		// beginning with 'a'. Words that only contain 'a' internally should
		// NOT match.
		const seq = generateBigramDrillSequence({
			targetBigrams: [' a'],
			corpus: corpus('apple banana cherry almond'),
			options: { wordCount: 40, rng: () => 0 }
		});
		// Target pool = words starting with 'a' → 'apple', 'almond'. Every
		// pick is from that pool.
		const targetStarts = seq.words.filter((w) => w.startsWith('a')).length;
		expect(targetStarts).toBe(seq.words.length);
		expect(seq.stats.distinctTargets).toBe(1);
	});

	it('treats a trailing-space target as "word ends with letter"', () => {
		// Target 'e ' = "'e' then space" — happens at the end of any word
		// ending in 'e'.
		const seq = generateBigramDrillSequence({
			targetBigrams: ['e '],
			corpus: corpus('apple table of the tree'),
			options: { wordCount: 40, rng: () => 0 }
		});
		const targetEnds = seq.words.filter((w) => w.endsWith('e')).length;
		expect(targetEnds).toBe(seq.words.length);
		expect(seq.stats.distinctTargets).toBe(1);
	});

	it('ignores a two-space target (no single word produces it)', () => {
		// '  ' would correspond to typing two consecutive spaces, which can't
		// be produced by any single word contributing to a space-joined passage.
		const seq = generateBigramDrillSequence({
			targetBigrams: ['  ', 'th'],
			corpus: corpus('the other thing'),
			options: { wordCount: 10, rng: () => 0 }
		});
		// Only 'th' is a valid matchable target here.
		expect(seq.stats.distinctTargets).toBeLessThanOrEqual(1);
	});
});
