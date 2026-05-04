import { describe, expect, it } from 'vitest';
import {
	buildLivePriorityTargets,
	buildLiveUndertrained,
	extractBigramAggregates,
	generateDiagnosticReport,
	summarizeBigrams
} from './index';
import { annotateFirstInputs } from '../session/postprocess';
import { DEFAULT_THRESHOLDS } from '../support/core';
import type {
	BigramAggregate,
	BigramClassification,
	BigramSample,
	KeystrokeEvent,
	SessionSummary
} from '../support/core';

function ev(position: number, expected: string, actual: string, timestamp: number): KeystrokeEvent {
	return { position, expected, actual, timestamp, wordIndex: 0, positionInWord: position };
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

function session(
	id: string,
	timestamp: number,
	aggregates: BigramAggregate[] = []
): SessionSummary {
	return {
		id,
		timestamp,
		type: 'real-text',
		durationMs: 60_000,
		wpm: 50,
		errorRate: 0,
		bigramAggregates: aggregates
	};
}

// Single session with one struggling acquisition bigram ('th') and one healthy
// one ('er'). Used by priority-ordering tests that need a clear winner.
function acquisitionVsHealthyFixture(): SessionSummary[] {
	return [
		session('s1', 100, [
			agg('th', 's1', {
				meanTime: 400,
				errorRate: 0.2,
				classification: 'acquisition',
				samples: Array.from({ length: 20 }, () => ({ correct: false, timing: 400 }))
			}),
			agg('er', 's1', {
				meanTime: 120,
				errorRate: 0,
				classification: 'healthy',
				samples: cleanSamples(20, 120)
			})
		])
	];
}

describe('extractBigramAggregates', () => {
	it('returns empty for < 2 events', () => {
		expect(extractBigramAggregates([], 's1')).toEqual([]);
		expect(extractBigramAggregates([ev(0, 'a', 'a', 0)], 's1')).toEqual([]);
	});

	it('averages timing only across clean pairs; errors attributed to right char', () => {
		// "th" clean (Δ=100), "th" with wrong 't' (Δ ignored, error counted).
		const result = extractBigramAggregates(
			[ev(0, 't', 't', 100), ev(1, 'h', 'h', 200), ev(2, 't', 'x', 300), ev(3, 'h', 'h', 400)],
			's1'
		);
		const th = result.find((r) => r.bigram === 'th')!;
		expect(th.occurrences).toBe(2);
		expect(th.meanTime).toBe(100);
		expect(th.errorCount).toBe(0); // right char ('h') was always correct
	});

	describe('burst follow-ups', () => {
		// Pipeline test: raw events → annotateFirstInputs → extractBigramAggregates.
		// Only the first wrong key in a run should produce a bigram error sample;
		// subsequent wrongs are dropped entirely (no occurrence, no error).
		it('drops follow-up wrongs in a burst from bigram stats', () => {
			// Expected "hello"; user typed "hxyzlo". Positions 1,2,3 wrong in a row.
			const raw: KeystrokeEvent[] = [
				ev(0, 'h', 'h', 0),
				ev(1, 'e', 'x', 100),
				ev(2, 'l', 'y', 200),
				ev(3, 'l', 'z', 300),
				ev(4, 'o', 'o', 400)
			];
			const result = extractBigramAggregates(annotateFirstInputs(raw), 's1');

			// "he": right (e) wrong, first in burst → kept as 1 occurrence, 1 error.
			const he = result.find((r) => r.bigram === 'he')!;
			expect(he.occurrences).toBe(1);
			expect(he.errorCount).toBe(1);

			// "el" and "ll": right chars (l, l) are burst follow-ups → fully dropped.
			expect(result.find((r) => r.bigram === 'el')).toBeUndefined();
			expect(result.find((r) => r.bigram === 'll')).toBeUndefined();

			// "lo": right (o) is correct, not in burst → kept (1 occurrence, 0 error).
			// Left (l) wrong so timing is null but the occurrence still counts.
			const lo = result.find((r) => r.bigram === 'lo')!;
			expect(lo.occurrences).toBe(1);
			expect(lo.errorCount).toBe(0);
		});

		it('non-consecutive wrongs are not bursts', () => {
			// "abcde" typed "axcye": wrongs at positions 1 and 3, separated by a correct 'c'.
			const raw: KeystrokeEvent[] = [
				ev(0, 'a', 'a', 0),
				ev(1, 'b', 'x', 100),
				ev(2, 'c', 'c', 200),
				ev(3, 'd', 'y', 300),
				ev(4, 'e', 'e', 400)
			];
			const result = extractBigramAggregates(annotateFirstInputs(raw), 's1');

			// Both 'b' and 'd' wrongs should produce errors against their right-char bigrams.
			expect(result.find((r) => r.bigram === 'ab')!.errorCount).toBe(1);
			expect(result.find((r) => r.bigram === 'cd')!.errorCount).toBe(1);
		});
	});

	it('classifies with enough occurrences and clean timing', () => {
		// Feed 10 clean "th" pairs fast enough to be healthy.
		const events: KeystrokeEvent[] = [];
		for (let i = 0; i < 10; i++) {
			events.push(ev(i * 2, 't', 't', i * 1000));
			events.push(ev(i * 2 + 1, 'h', 'h', i * 1000 + 50));
		}
		const [th] = extractBigramAggregates(events, 's1');
		expect(th.bigram).toBe('th');
		expect(th.classification).toBe('healthy');
	});
});

describe('generateDiagnosticReport', () => {
	it('derives baseline WPM from wall-clock event span', () => {
		// 61 distinct positions spanning 0 to 60_000ms → 61/5/(60/60) ≈ 12.2 WPM.
		const events: KeystrokeEvent[] = [];
		for (let i = 0; i < 61; i++) events.push(ev(i, 'a', 'a', i * 1000));
		const report = generateDiagnosticReport({ events });
		expect(report.baselineWPM).toBeCloseTo(12.2, 1);
	});

	it('returns 0 baseline for degenerate inputs', () => {
		expect(generateDiagnosticReport({ events: [] }).baselineWPM).toBe(0);
		expect(generateDiagnosticReport({ events: [ev(0, 'a', 'a', 0)] }).baselineWPM).toBe(0);
	});
});

describe('summarizeBigrams', () => {
	it('uses the rolling window for classification and lifetime sum for occurrences', () => {
		const sessions = [
			session('s1', 100, [
				agg('th', 's1', {
					classification: 'hasty',
					occurrences: 12,
					errorRate: 0.15,
					samples: cleanSamples(12, 100)
				})
			]),
			session('s2', 200, [
				agg('th', 's2', {
					classification: 'healthy',
					occurrences: 20,
					errorRate: 0,
					samples: cleanSamples(20, 100)
				})
			])
		];
		const rows = summarizeBigrams(sessions, undefined, DEFAULT_THRESHOLDS);
		const th = rows.find((r) => r.bigram === 'th')!;
		expect(th.classification).toBe('healthy');
		expect(th.occurrences).toBe(32);
	});

	it('sorts by priority score (badness × corpus frequency) descending', () => {
		const rows = summarizeBigrams(
			acquisitionVsHealthyFixture(),
			{ th: 10, er: 10 },
			DEFAULT_THRESHOLDS
		);
		expect(rows[0].bigram).toBe('th');
	});
});

describe('buildLivePriorityTargets', () => {
	it('excludes healthy and unclassified bigrams', () => {
		const targets = buildLivePriorityTargets(acquisitionVsHealthyFixture(), { th: 10, er: 10 });
		expect(targets.map((t) => t.bigram)).toEqual(['th']);
	});

	it('scopes by classification filter when supplied', () => {
		const sessions = [
			session('s1', 100, [
				agg('th', 's1', {
					meanTime: 100,
					errorRate: 0.2,
					classification: 'hasty',
					samples: Array.from({ length: 20 }, () => ({ correct: false, timing: 100 }))
				}),
				agg('er', 's1', {
					meanTime: 400,
					errorRate: 0,
					classification: 'fluency',
					samples: cleanSamples(20, 400)
				})
			])
		];
		const accuracyTargets = buildLivePriorityTargets(
			sessions,
			{ th: 10, er: 10 },
			undefined,
			undefined,
			['hasty', 'acquisition']
		);
		expect(accuracyTargets.map((t) => t.bigram)).toEqual(['th']);
	});
});

describe('buildLiveUndertrained', () => {
	it('returns corpus bigrams with fewer than the minimum lifetime occurrences', () => {
		// th has 5 occurrences (< 10); er has 20 (≥ 10); zz has 0.
		const sessions = [
			session('s1', 100, [
				agg('th', 's1', { occurrences: 5 }),
				agg('er', 's1', { occurrences: 20 })
			])
		];
		const under = buildLiveUndertrained(sessions, { th: 10, er: 8, zz: 1 });
		// Sorted by frequency desc: th (10) > zz (1). er is well-trained.
		expect(under).toEqual(['th', 'zz']);
	});

	it('returns empty when no corpus is supplied', () => {
		expect(buildLiveUndertrained([], undefined)).toEqual([]);
	});
});
