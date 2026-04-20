import { describe, it, expect } from 'vitest';
import {
	rollingAverage,
	rollingStdDev,
	buildWpmSeries,
	buildBigramTrend,
	summarizeBigrams,
	aggregateLastNOccurrences,
	countGraduations,
	tallyClassificationMix,
	WPM_ROLLING_WINDOW
} from './metrics';
import type { SessionSummary } from '../session/types';
import type { BigramAggregate, BigramClassification, BigramSample } from '../bigram/types';

// Small session factory so tests stay readable. Only the fields the metrics
// layer actually reads need values; the rest are defaulted.
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

describe('rollingAverage', () => {
	it('returns null for leading positions before the window fills', () => {
		expect(rollingAverage([1, 2, 3, 4], 3)).toEqual([null, null, 2, 3]);
	});

	it('window of 1 is the raw series', () => {
		expect(rollingAverage([5, 10, 15], 1)).toEqual([5, 10, 15]);
	});

	it('handles an empty input', () => {
		expect(rollingAverage([], 3)).toEqual([]);
	});

	it('rejects windows < 1', () => {
		expect(() => rollingAverage([1, 2], 0)).toThrow(RangeError);
	});
});

describe('rollingStdDev', () => {
	it('returns null until the window fills, then sample SD', () => {
		// Sample SD of [2, 4, 4, 4, 5, 5, 7, 9] over window=8: variance (n-1) = 32/7,
		// so SD = √(32/7) ≈ 2.138. (Population SD would be 2; we use sample SD.)
		const result = rollingStdDev([2, 4, 4, 4, 5, 5, 7, 9], 8);
		expect(result.slice(0, 7)).toEqual([null, null, null, null, null, null, null]);
		expect(result[7]).toBeCloseTo(Math.sqrt(32 / 7), 10);
	});

	it('window of 1 emits zeros (no dispersion to measure)', () => {
		expect(rollingStdDev([5, 10, 15], 1)).toEqual([0, 0, 0]);
	});
});

describe('buildWpmSeries', () => {
	it('orders sessions oldest-first even if input is scrambled', () => {
		const out = buildWpmSeries([
			session('c', 300, 60),
			session('a', 100, 40),
			session('b', 200, 50)
		]);
		expect(out.map((p) => p.sessionId)).toEqual(['a', 'b', 'c']);
	});

	it('emits null rolling/σ until the 7-session window fills', () => {
		const sessions: SessionSummary[] = [];
		for (let i = 0; i < 10; i++) sessions.push(session(`s${i}`, i * 1000, 50 + i));
		const out = buildWpmSeries(sessions);
		// Positions 0..5 (before index 6) have an unfilled window.
		for (let i = 0; i < WPM_ROLLING_WINDOW - 1; i++) {
			expect(out[i].rolling).toBeNull();
			expect(out[i].plus1Sigma).toBeNull();
			expect(out[i].minus1Sigma).toBeNull();
		}
		expect(out[WPM_ROLLING_WINDOW - 1].rolling).not.toBeNull();
		expect(out[WPM_ROLLING_WINDOW - 1].plus1Sigma).not.toBeNull();
	});

	it('σ envelope brackets the rolling mean symmetrically', () => {
		const sessions = Array.from({ length: 8 }, (_, i) => session(`s${i}`, i * 1000, 50 + i));
		const last = buildWpmSeries(sessions).at(-1)!;
		expect(last.plus1Sigma! - last.rolling!).toBeCloseTo(last.rolling! - last.minus1Sigma!, 10);
	});
});

describe('buildBigramTrend', () => {
	it('emits one point per session that observed the bigram, oldest-first', () => {
		const sessions = [
			session('s1', 100, 50, [agg('th', 's1', { meanTime: 300 })]),
			session('s2', 200, 55, [agg('th', 's2', { meanTime: 280 })]),
			// s3 never saw 'th' — should be skipped, not filled with zero.
			session('s3', 300, 60, [agg('er', 's3', { meanTime: 250 })])
		];
		const trend = buildBigramTrend(sessions, 'th');
		expect(trend.map((p) => p.meanTime)).toEqual([300, 280]);
		expect(trend[0].timestamp).toBe(100);
	});

	it('trims to the last `depth` points', () => {
		const sessions = Array.from({ length: 12 }, (_, i) =>
			session(`s${i}`, i * 100, 50, [agg('th', `s${i}`, { meanTime: 200 + i })])
		);
		const trend = buildBigramTrend(sessions, 'th', 5);
		expect(trend.length).toBe(5);
		// Last five mean times in order: 207..211.
		expect(trend.map((p) => p.meanTime)).toEqual([207, 208, 209, 210, 211]);
	});

	it('skips sessions where meanTime is non-finite', () => {
		const sessions = [
			session('s1', 100, 50, [agg('th', 's1', { meanTime: Number.NaN })]),
			session('s2', 200, 55, [agg('th', 's2', { meanTime: 280 })])
		];
		expect(buildBigramTrend(sessions, 'th').map((p) => p.meanTime)).toEqual([280]);
	});
});

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

function cleanSamples(n: number, timing: number): BigramSample[] {
	return Array.from({ length: n }, () => ({ correct: true, timing }));
}

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

describe('countGraduations', () => {
	it('counts bigrams that flipped into healthy', () => {
		const before = [
			agg('th', 's1', { classification: 'hasty' }),
			agg('er', 's1', { classification: 'healthy' })
		];
		const after = [
			agg('th', 's2', { classification: 'healthy' }),
			agg('er', 's2', { classification: 'healthy' }),
			// New bigram observed for the first time at healthy — also counts.
			agg('in', 's2', { classification: 'healthy' })
		];
		expect(countGraduations(before, after)).toBe(2);
	});

	it('does not count regressions as graduations', () => {
		const before = [agg('th', 's1', { classification: 'healthy' })];
		const after = [agg('th', 's2', { classification: 'hasty' })];
		expect(countGraduations(before, after)).toBe(0);
	});
});

describe('tallyClassificationMix', () => {
	it('counts each classified bigram into its bucket and keeps unclassified separate', () => {
		const rows = [
			{ classification: 'healthy' as BigramClassification },
			{ classification: 'healthy' as BigramClassification },
			{ classification: 'fluency' as BigramClassification },
			{ classification: 'hasty' as BigramClassification },
			{ classification: 'acquisition' as BigramClassification },
			{ classification: 'acquisition' as BigramClassification },
			{ classification: 'unclassified' as BigramClassification },
			{ classification: 'unclassified' as BigramClassification },
			{ classification: 'unclassified' as BigramClassification }
		];
		expect(tallyClassificationMix(rows)).toEqual({
			counts: { healthy: 2, fluency: 1, hasty: 1, acquisition: 2 },
			unclassified: 3
		});
	});

	it('returns all-zero buckets for an empty input', () => {
		expect(tallyClassificationMix([])).toEqual({
			counts: { healthy: 0, fluency: 0, hasty: 0, acquisition: 0 },
			unclassified: 0
		});
	});
});
