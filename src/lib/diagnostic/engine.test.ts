import { describe, expect, it } from 'vitest';
import { generateDiagnosticReport } from './engine';
import type { BigramAggregate } from '../bigram/types';
import type { KeystrokeEvent } from '../typing/types';
import { TARGET_WPM_MULTIPLIER } from '../models';

/**
 * Minimal aggregate factory. Defaults represent a borderline-but-fine
 * bigram; each test overrides the fields it cares about.
 */
function agg(overrides: Partial<BigramAggregate>): BigramAggregate {
	return {
		bigram: 'ab',
		sessionId: 'test',
		occurrences: 20,
		meanTime: 140,
		stdTime: 10,
		errorCount: 0,
		errorRate: 0,
		classification: 'healthy',
		...overrides
	};
}

/** 5-char word ranging timestamp [start, start + 4*dt] at wordIndex w. */
function wordEvents(start: number, dt: number, w: number, basePos: number): KeystrokeEvent[] {
	return Array.from({ length: 5 }, (_, i) => ({
		position: basePos + i,
		timestamp: start + i * dt,
		expected: 'a',
		actual: 'a',
		wordIndex: w,
		positionInWord: i
	}));
}

describe('generateDiagnosticReport', () => {
	it('fills baseline/target WPM from events, scaling by spec multiplier', () => {
		// Two 5-char words at 200ms/char → per-word wpm = 5/5 / (800/60000) = 75.
		// Mean of [75, 75] = 75.
		const events = [...wordEvents(0, 200, 0, 0), ...wordEvents(2000, 200, 1, 5)];
		const r = generateDiagnosticReport({
			sessionId: 's1',
			timestamp: 42,
			events,
			aggregates: []
		});
		expect(r.baselineWPM).toBeCloseTo(75, 5);
		expect(r.targetWPM).toBeCloseTo(75 * TARGET_WPM_MULTIPLIER, 5);
	});

	it('counts aggregates by classification, dropping unclassified', () => {
		const aggregates = [
			agg({ classification: 'healthy' }),
			agg({ classification: 'healthy' }),
			agg({ classification: 'fluency' }),
			agg({ classification: 'hasty' }),
			agg({ classification: 'acquisition' }),
			agg({ classification: 'unclassified' })
		];
		const r = generateDiagnosticReport({
			sessionId: 's',
			timestamp: 0,
			events: [],
			aggregates
		});
		expect(r.counts).toEqual({ healthy: 2, fluency: 1, hasty: 1, acquisition: 1 });
	});

	it('topBottlenecks.fluency is sorted by meanTime desc', () => {
		const aggregates = [
			agg({ bigram: 'aa', classification: 'fluency', meanTime: 300 }),
			agg({ bigram: 'bb', classification: 'fluency', meanTime: 500 }),
			agg({ bigram: 'cc', classification: 'fluency', meanTime: 200 })
		];
		const r = generateDiagnosticReport({
			sessionId: 's',
			timestamp: 0,
			events: [],
			aggregates
		});
		expect(r.topBottlenecks.fluency).toEqual(['bb', 'aa', 'cc']);
	});

	it('topBottlenecks.hasty is sorted by errorRate desc', () => {
		const aggregates = [
			agg({ bigram: 'aa', classification: 'hasty', errorRate: 0.1 }),
			agg({ bigram: 'bb', classification: 'hasty', errorRate: 0.3 }),
			agg({ bigram: 'cc', classification: 'hasty', errorRate: 0.2 })
		];
		const r = generateDiagnosticReport({
			sessionId: 's',
			timestamp: 0,
			events: [],
			aggregates
		});
		expect(r.topBottlenecks.hasty).toEqual(['bb', 'cc', 'aa']);
	});

	it('topBottlenecks cap each class at 5 entries (spec §7.3)', () => {
		const aggregates = Array.from({ length: 8 }, (_, i) =>
			agg({ bigram: `f${i}`, classification: 'fluency', meanTime: 300 + i })
		);
		const r = generateDiagnosticReport({
			sessionId: 's',
			timestamp: 0,
			events: [],
			aggregates
		});
		expect(r.topBottlenecks.fluency).toHaveLength(5);
	});

	it('priorityTargets weight by corpus frequency when supplied', () => {
		// Two equally-slow bigrams; corpus makes `ra` 10× more common than `zx`.
		// `ra` should win the priority list.
		const aggregates = [
			agg({ bigram: 'ra', classification: 'fluency', meanTime: 300, errorRate: 0 }),
			agg({ bigram: 'zx', classification: 'fluency', meanTime: 300, errorRate: 0 })
		];
		const r = generateDiagnosticReport({
			sessionId: 's',
			timestamp: 0,
			events: [],
			aggregates,
			corpusBigramFrequencies: { ra: 100, zx: 10 }
		});
		expect(r.priorityTargets[0].bigram).toBe('ra');
		expect(r.priorityTargets[0].score).toBeGreaterThan(r.priorityTargets[1].score);
	});

	it('priorityTargets cap at 10 (spec §7.3)', () => {
		const aggregates = Array.from({ length: 15 }, (_, i) =>
			agg({ bigram: `b${i}`, classification: 'fluency', meanTime: 500 + i })
		);
		const r = generateDiagnosticReport({
			sessionId: 's',
			timestamp: 0,
			events: [],
			aggregates
		});
		expect(r.priorityTargets).toHaveLength(10);
	});

	it('excludes healthy and unclassified from priorityTargets', () => {
		const aggregates = [
			agg({ bigram: 'hh', classification: 'healthy' }),
			agg({ bigram: 'un', classification: 'unclassified', occurrences: 3 }),
			agg({ bigram: 'fl', classification: 'fluency', meanTime: 400 })
		];
		const r = generateDiagnosticReport({
			sessionId: 's',
			timestamp: 0,
			events: [],
			aggregates
		});
		expect(r.priorityTargets.map((p) => p.bigram)).toEqual(['fl']);
	});

	it('corpusFit returns stub (0, []) when no corpus supplied', () => {
		// Bridges the Phase 4 gap — engine is usable before the corpus
		// pipeline exists.
		const r = generateDiagnosticReport({
			sessionId: 's',
			timestamp: 0,
			events: [],
			aggregates: [agg({ classification: 'healthy', occurrences: 50 })]
		});
		expect(r.corpusFit).toEqual({ coverageRatio: 0, undertrained: [] });
	});

	it('corpusFit coverageRatio reflects the MIN_OCCURRENCES floor (10, spec §3.1)', () => {
		// Corpus has 4 bigrams. We've observed 'aa' 10×, 'bb' 100×, 'cc' 5× (under),
		// 'dd' 0× (unobserved). Coverage = 2/4 = 0.5.
		const aggregates = [
			agg({ bigram: 'aa', occurrences: 10 }),
			agg({ bigram: 'bb', occurrences: 100 }),
			agg({ bigram: 'cc', occurrences: 5 })
			// dd not observed at all
		];
		const r = generateDiagnosticReport({
			sessionId: 's',
			timestamp: 0,
			events: [],
			aggregates,
			corpusBigramFrequencies: { aa: 1, bb: 1, cc: 1, dd: 1 }
		});
		expect(r.corpusFit.coverageRatio).toBe(0.5);
	});

	it('corpusFit.undertrained is ordered by corpus frequency desc', () => {
		const r = generateDiagnosticReport({
			sessionId: 's',
			timestamp: 0,
			events: [],
			aggregates: [],
			// All three have 0 observations → all undertrained. Order by freq.
			corpusBigramFrequencies: { low: 1, med: 50, high: 100 }
		});
		expect(r.corpusFit.undertrained).toEqual(['high', 'med', 'low']);
	});

	it('passes through sessionId, timestamp, and aggregates snapshot', () => {
		const aggregates = [agg({ bigram: 'xy', classification: 'hasty', errorRate: 0.5 })];
		const r = generateDiagnosticReport({
			sessionId: 'session-xyz',
			timestamp: 12345,
			events: [],
			aggregates
		});
		expect(r.sessionId).toBe('session-xyz');
		expect(r.timestamp).toBe(12345);
		// Snapshot — caller shouldn't be able to mutate internal state.
		expect(r.aggregates).toEqual(aggregates);
		expect(r.aggregates).not.toBe(aggregates);
	});
});
