import { describe, expect, it } from 'vitest';
import { selectRealTextSentence } from './selection';
import { loadCorpus } from './loader';
import type { CorpusConfig } from './types';

const CONFIG: CorpusConfig = { id: 'test', language: 'en', wordlistId: 'test' };

/** Deterministic RNG that walks a preset sequence. Falls back to 0 past the end. */
function seededRng(sequence: number[]): () => number {
	let i = 0;
	return () => (i < sequence.length ? sequence[i++] : 0);
}

describe('selectRealTextSentence', () => {
	it('throws on empty corpus', () => {
		const empty = loadCorpus(CONFIG, '');
		expect(() => selectRealTextSentence(empty)).toThrow();
	});

	it('enforces spec §4.2 minimum word count (≥8) even when caller asks for less', () => {
		const c = loadCorpus(CONFIG, 'the of and a to in that is it');
		// Asking for 3 should clamp up to 8.
		const sentence = selectRealTextSentence(c, { wordCount: 3, rng: () => 0 });
		expect(sentence.split(' ')).toHaveLength(8);
	});

	it('produces the requested word count when above the min', () => {
		const c = loadCorpus(CONFIG, 'the of and a to in that is it for on are');
		const sentence = selectRealTextSentence(c, { wordCount: 12, rng: () => 0 });
		expect(sentence.split(' ')).toHaveLength(12);
	});

	it('is deterministic under a seeded RNG', () => {
		const c = loadCorpus(CONFIG, 'one two three four five six seven eight');
		// rng sequence chosen to pick a known sequence — with cumulative-weight
		// sampling, `rng()=0` always picks word 0 ('one') since it's the first bucket.
		const a = selectRealTextSentence(c, { wordCount: 8, rng: () => 0 });
		const b = selectRealTextSentence(c, { wordCount: 8, rng: () => 0 });
		expect(a).toBe(b);
		// With uniform 0 → always the first word (highest-weighted).
		expect(a).toBe('one one one one one one one one');
	});

	it('boosts target-bigram-containing words in sampling', () => {
		// Corpus has 10 words, one of which ("the") contains target bigram "th".
		// Over many samples, "the" should appear much more than 1/10 of the time.
		const c = loadCorpus(CONFIG, 'alpha beta gamma delta epsilon zeta eta theta iota the');
		let thCount = 0;
		const N = 200;
		// Deterministic-ish: use a sequence of fractional picks.
		const seq: number[] = [];
		for (let i = 0; i < N * 8; i++) seq.push((i / (N * 8)) % 1);
		const rng = seededRng(seq);
		for (let i = 0; i < N; i++) {
			const sentence = selectRealTextSentence(c, {
				wordCount: 8,
				targetBigrams: ['th'],
				rng
			});
			for (const w of sentence.split(' ')) {
				if (w.includes('th')) thCount++;
			}
		}
		// Without boost, "th"-words are rank-9/10 and very rare. With 5× boost
		// applied to "the" + "theta" (both contain 'th'), they should comfortably
		// appear in > 5% of the N*8 sampled words.
		const total = N * 8;
		expect(thCount / total).toBeGreaterThan(0.05);
	});

	it('returns the first word for rng=0 (highest-weight word wins)', () => {
		const c = loadCorpus(CONFIG, 'the of and a to in that is');
		const sentence = selectRealTextSentence(c, { wordCount: 8, rng: () => 0 });
		// 'the' is rank 1, weight 1 — the largest bucket, so rng=0 always hits it.
		expect(sentence.split(' ').every((w) => w === 'the')).toBe(true);
	});
});
