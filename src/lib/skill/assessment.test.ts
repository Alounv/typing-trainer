import { describe, it, expect } from 'vitest';
import {
	summarizeBigrams,
	aggregateLastNOccurrences,
	buildLivePriorityTargets,
	buildLiveUndertrained
} from './assessment';
import type {
	SessionSummary,
	BigramAggregate,
	BigramClassification,
	BigramSample
} from '../support/core/types';

function session(
	id: string,
	timestamp: number,
	wpm: number,
	aggregates: BigramAggregate[] = []
): SessionSummary {
	return {
		id,
		timestamp,
		type: 'real-text',
		durationMs: 60_000,
		wpm,
		errorRate: 0,
		bigramAggregates: aggregates
	};
}

function agg(
	bigram: string,
	sessionId: string,
	overrides: Partial<BigramAggregate> = {}
): BigramAggregate {
	return {
		bigram,
		sessionId,
		occurrences: 15,
		meanTime: 200,
		stdTime: 30,
		errorCount: 0,
		errorRate: 0,
		classification: 'healthy' as BigramClassification,
		...overrides
	};
}

function cleanSamples(n: number, timing: number): BigramSample[] {
	return Array.from({ length: n }, () => ({ correct: true, timing }));
}

describe('summarizeBigrams', () => {
	it('uses the most recent snapshot for classification, lifetime sum for occurrences', () => {
		const sessions = [
			session('s1', 100, 50, [
				agg('th', 's1', { classification: 'hasty', occurrences: 12, errorRate: 0.15 })
			]),
			session('s2', 200, 55, [
				agg('th', 's2', { classification: 'healthy', occurrences: 20, errorRate: 0.02 })
			])
		];
		const rows = summarizeBigrams(sessions);
		const th = rows.find((r) => r.bigram === 'th')!;
		expect(th.classification).toBe('healthy');
		expect(th.occurrences).toBe(32);
		expect(th.errorRate).toBeCloseTo(0.02);
	});

	it('sorts by priority score descending by default', () => {
		const sessions = [
			session('s1', 100, 50, [
				agg('th', 's1', { meanTime: 400, errorRate: 0.2, classification: 'acquisition' }),
				agg('er', 's1', { meanTime: 150, errorRate: 0, classification: 'healthy' })
			])
		];
		const rows = summarizeBigrams(sessions, { th: 10, er: 10 });
		expect(rows[0].bigram).toBe('th');
	});

	it('weights by corpus frequency when provided', () => {
		const sessions = [
			session('s1', 100, 50, [
				agg('rare', 's1', { meanTime: 400, errorRate: 0.2, classification: 'acquisition' }),
				agg('common', 's1', { meanTime: 250, errorRate: 0.05, classification: 'hasty' })
			])
		];
		// 'common' has lower raw badness but 100× the frequency — should rank first.
		const rows = summarizeBigrams(sessions, { rare: 1, common: 100 });
		expect(rows[0].bigram).toBe('common');
	});
});

describe('aggregateLastNOccurrences', () => {
	it('returns undefined when no session in the set carries samples', () => {
		const sessions = [session('s1', 100, 50, [agg('th', 's1')])];
		expect(aggregateLastNOccurrences(sessions, 'th')).toBeUndefined();
	});

	it('pools samples newest → oldest up to the window', () => {
		const sessions = [
			session('s1', 100, 50, [
				agg('th', 's1', {
					samples: [
						{ correct: true, timing: 10 },
						{ correct: true, timing: 20 },
						{ correct: true, timing: 30 },
						{ correct: true, timing: 40 }
					]
				})
			]),
			session('s2', 200, 50, [
				agg('th', 's2', {
					samples: [
						{ correct: true, timing: 100 },
						{ correct: true, timing: 200 },
						{ correct: true, timing: 300 }
					]
				})
			])
		];
		// s2 (newest) fills 3 slots; the remaining 2 come from the tail of s1.
		const rolling = aggregateLastNOccurrences(sessions, 'th', 5)!;
		expect(rolling.occurrences).toBe(5);
		expect(rolling.meanTime).toBeCloseTo((100 + 200 + 300 + 30 + 40) / 5);
	});

	it('skips legacy sessions (no samples) and uses only sessions that have them', () => {
		const sessions = [
			session('s1', 100, 50, [agg('th', 's1', { errorRate: 0.5 })]), // legacy
			session('s2', 200, 50, [agg('th', 's2', { samples: cleanSamples(3, 120) })])
		];
		const rolling = aggregateLastNOccurrences(sessions, 'th', 10)!;
		expect(rolling.occurrences).toBe(3);
		expect(rolling.meanTime).toBe(120);
		expect(rolling.errorRate).toBe(0);
	});

	it('yields NaN meanTime when no pooled sample has a timing', () => {
		const sessions = [
			session('s1', 100, 50, [
				agg('th', 's1', {
					samples: [
						{ correct: false, timing: null },
						{ correct: false, timing: null }
					]
				})
			])
		];
		const rolling = aggregateLastNOccurrences(sessions, 'th', 10)!;
		expect(Number.isNaN(rolling.meanTime)).toBe(true);
		expect(rolling.errorRate).toBe(1);
	});
});

describe('summarizeBigrams — sliding window', () => {
	it('classifies from the rolling window, not the latest session in isolation', () => {
		// Latest session alone has 3 occurrences (below MIN_OCCURRENCES) — without
		// pooling this would fall back to 'unclassified' despite rich history.
		const sessions = [
			session('s1', 100, 50, [agg('th', 's1', { samples: cleanSamples(40, 80) })]),
			session('s2', 200, 50, [agg('th', 's2', { samples: cleanSamples(3, 80) })])
		];
		const th = summarizeBigrams(sessions).find((r) => r.bigram === 'th')!;
		expect(th.classification).toBe('healthy');
		expect(th.meanTime).toBe(80);
	});

	it('falls back to the latest session aggregate when no session has samples', () => {
		const sessions = [
			session('s1', 100, 50, [agg('th', 's1', { classification: 'hasty', errorRate: 0.2 })]),
			session('s2', 200, 50, [agg('th', 's2', { classification: 'healthy', errorRate: 0.02 })])
		];
		const th = summarizeBigrams(sessions).find((r) => r.bigram === 'th')!;
		expect(th.classification).toBe('healthy');
		expect(th.errorRate).toBeCloseTo(0.02);
	});
});

describe('buildLivePriorityTargets', () => {
	function bigramSession(
		id: string,
		timestamp: number,
		bigram: string,
		samples: BigramSample[]
	): SessionSummary {
		return session(id, timestamp, 50, [agg(bigram, id, { occurrences: samples.length, samples })]);
	}

	it('returns [] when no session carries classifiable data', () => {
		expect(buildLivePriorityTargets([])).toEqual([]);
	});

	it('excludes healthy and unclassified rows', () => {
		const sessions = [
			bigramSession('s1', 100, 'fast', cleanSamples(20, 80)),
			bigramSession('s2', 200, 'sparse', cleanSamples(3, 400))
		];
		expect(buildLivePriorityTargets(sessions)).toEqual([]);
	});

	it('classifies bigrams from pooled samples', () => {
		const hastySamples: BigramSample[] = Array.from({ length: 20 }, (_, i) => ({
			correct: i % 5 !== 0,
			timing: 120
		}));
		const sessions = [
			bigramSession('s1', 100, 'fl', cleanSamples(20, 300)),
			bigramSession('s2', 200, 'ht', hastySamples)
		];
		const byBigram = new Map(buildLivePriorityTargets(sessions).map((t) => [t.bigram, t]));
		expect(byBigram.get('fl')?.classification).toBe('fluency');
		expect(byBigram.get('ht')?.classification).toBe('hasty');
	});

	it('orders by priority score and honours the limit', () => {
		const bad: BigramSample[] = Array.from({ length: 20 }, (_, i) => ({
			correct: i % 3 !== 0,
			timing: 500
		}));
		const sessions = [bigramSession('s1', 100, 'ra', bad), bigramSession('s2', 200, 'co', bad)];
		const ranked = buildLivePriorityTargets(sessions, { ra: 1, co: 100 });
		expect(ranked[0].bigram).toBe('co');
		expect(buildLivePriorityTargets(sessions, { ra: 1, co: 100 }, undefined, 1)).toHaveLength(1);
	});

	it('scopes the top-N to a specific class when classifications is passed', () => {
		// Hasty (errors) outranks fluency (merely slow) on the cross-class score,
		// but a fluency-scoped caller must still see the fluency bigram.
		const hastySamples: BigramSample[] = Array.from({ length: 20 }, (_, i) => ({
			correct: i % 5 !== 0,
			timing: 120
		}));
		const sessions = [
			bigramSession('s1', 100, 'fl', cleanSamples(20, 300)),
			bigramSession('s2', 200, 'ht', hastySamples)
		];
		const fluencyOnly = buildLivePriorityTargets(sessions, undefined, undefined, 10, ['fluency']);
		expect(fluencyOnly.map((t) => t.bigram)).toEqual(['fl']);
		const accuracyOnly = buildLivePriorityTargets(sessions, undefined, undefined, 10, [
			'hasty',
			'acquisition'
		]);
		expect(accuracyOnly.map((t) => t.bigram)).toEqual(['ht']);
	});
});

describe('buildLiveUndertrained', () => {
	function sessionWithCounts(
		id: string,
		timestamp: number,
		counts: Record<string, number>
	): SessionSummary {
		const aggregates = Object.entries(counts).map(([bigram, occurrences]) =>
			agg(bigram, id, { occurrences })
		);
		return session(id, timestamp, 50, aggregates);
	}

	it('returns [] when the corpus is absent', () => {
		expect(buildLiveUndertrained([], undefined)).toEqual([]);
	});

	it('returns [] when the corpus is empty', () => {
		expect(buildLiveUndertrained([], {})).toEqual([]);
	});

	it('includes corpus bigrams with lifetime occurrences below the threshold', () => {
		const sessions = [sessionWithCounts('s1', 100, { th: 20, he: 3, in: 1 })];
		const under = buildLiveUndertrained(sessions, { th: 10, he: 8, in: 5 });
		expect(under).toEqual(['he', 'in']);
	});

	it('sums occurrences across sessions (lifetime, not latest-session)', () => {
		const sessions = [
			sessionWithCounts('s1', 100, { th: 6 }),
			sessionWithCounts('s2', 200, { th: 5 })
		];
		expect(buildLiveUndertrained(sessions, { th: 10, he: 5 })).toEqual(['he']);
	});

	it('honors a custom minOccurrences threshold', () => {
		const sessions = [sessionWithCounts('s1', 100, { th: 4 })];
		expect(buildLiveUndertrained(sessions, { th: 1 }, 3)).toEqual([]);
		expect(buildLiveUndertrained(sessions, { th: 1 }, 5)).toEqual(['th']);
	});
});
