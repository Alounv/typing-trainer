import { describe, expect, it } from 'vitest';
import { computeSessionDelta } from './delta';
import type {
	SessionSummary,
	SessionType,
	BigramAggregate,
	BigramClassification
} from '../core/types';
import { WPM_ROLLING_WINDOW } from './metrics';
import { DEFAULT_HIGH_ERROR_THRESHOLD } from '../core';

function makeAggregate(overrides: Partial<BigramAggregate> = {}): BigramAggregate {
	return {
		bigram: 'th',
		sessionId: overrides.sessionId ?? 's',
		occurrences: 10,
		meanTime: 140,
		stdTime: 20,
		errorCount: 0,
		errorRate: 0,
		classification: 'healthy',
		...overrides
	};
}

function makeSession(overrides: Partial<SessionSummary> = {}): SessionSummary {
	return {
		id: 's',
		timestamp: 1_000,
		type: (overrides.type as SessionType | undefined) ?? 'bigram-drill',
		durationMs: 60_000,
		wpm: 60,
		errorRate: 0.02,
		bigramsTargeted: ['th'],
		bigramAggregates: [],
		...overrides
	};
}

describe('computeSessionDelta — WPM verdict', () => {
	it('marks a first-ever session as "first" with null baseline', () => {
		const current = makeSession({ id: 'only', wpm: 65 });
		const delta = computeSessionDelta(current, [current]);
		expect(delta.wpm.verdict).toBe('first');
		expect(delta.wpm.rollingAvg).toBeNull();
		expect(delta.wpm.deltaPct).toBeNull();
		expect(delta.wpm.baselineSampleSize).toBe(0);
	});

	it.each([
		{ label: 'clearly up', currentWpm: 70, prevAvg: 60, expected: 'up' as const },
		{ label: 'clearly down', currentWpm: 50, prevAvg: 60, expected: 'down' as const },
		{ label: 'flat within band', currentWpm: 60.5, prevAvg: 60, expected: 'flat' as const },
		{ label: 'equal to baseline', currentWpm: 60, prevAvg: 60, expected: 'flat' as const }
	])('classifies $label as $expected', ({ currentWpm, prevAvg, expected }) => {
		// Three prior sessions at `prevAvg` — simple mean.
		const prior = [0, 1, 2].map((i) =>
			makeSession({ id: `p${i}`, timestamp: 100 + i, wpm: prevAvg })
		);
		const current = makeSession({ id: 'now', timestamp: 500, wpm: currentWpm });
		const delta = computeSessionDelta(current, [...prior, current]);
		expect(delta.wpm.verdict).toBe(expected);
	});

	it('uses the most recent WPM_ROLLING_WINDOW priors only', () => {
		// 10 priors: first three are outliers (100 WPM), last seven are 60.
		// The rolling window is 7, so the baseline must be 60, not the full-mean ≈ 72.
		const priors: SessionSummary[] = [];
		for (let i = 0; i < 3; i++) {
			priors.push(makeSession({ id: `old${i}`, timestamp: i, wpm: 100 }));
		}
		for (let i = 0; i < WPM_ROLLING_WINDOW; i++) {
			priors.push(makeSession({ id: `new${i}`, timestamp: 100 + i, wpm: 60 }));
		}
		const current = makeSession({ id: 'now', timestamp: 999, wpm: 60 });
		const delta = computeSessionDelta(current, [...priors, current]);
		expect(delta.wpm.rollingAvg).toBe(60);
		expect(delta.wpm.baselineSampleSize).toBe(WPM_ROLLING_WINDOW);
		expect(delta.wpm.verdict).toBe('flat');
	});

	it('excludes the current session from its own baseline', () => {
		// A single prior at 60 + current at 60. If current were included in the
		// baseline, the deltaPct would still read 0 — so make current diverge
		// from the prior to force a distinguishable result.
		const prior = makeSession({ id: 'prev', timestamp: 100, wpm: 60 });
		const current = makeSession({ id: 'now', timestamp: 200, wpm: 90 });
		const delta = computeSessionDelta(current, [prior, current]);
		expect(delta.wpm.rollingAvg).toBe(60); // not (60+90)/2
		expect(delta.wpm.deltaPct).toBeCloseTo(0.5, 5);
		expect(delta.wpm.verdict).toBe('up');
	});
});

describe('computeSessionDelta — error rate and error floor', () => {
	it('flags error rate at or below the high-error threshold as below the floor', () => {
		const current = makeSession({ errorRate: DEFAULT_HIGH_ERROR_THRESHOLD });
		const delta = computeSessionDelta(current, [current]);
		expect(delta.errorFloor.below).toBe(true);
		expect(delta.errorFloor.threshold).toBe(DEFAULT_HIGH_ERROR_THRESHOLD);
	});

	it('flags error rate above the threshold as above the floor', () => {
		const current = makeSession({ errorRate: DEFAULT_HIGH_ERROR_THRESHOLD + 0.001 });
		const delta = computeSessionDelta(current, [current]);
		expect(delta.errorFloor.below).toBe(false);
	});

	it('handles a zero-baseline error rate without dividing by zero', () => {
		// Prior sessions were all error-free; this one has a few errors. A raw
		// (current - 0) / 0 would be Infinity; we treat it as an "up" verdict.
		const prior = [0, 1, 2].map((i) => makeSession({ id: `p${i}`, timestamp: i, errorRate: 0 }));
		const current = makeSession({ id: 'now', timestamp: 999, errorRate: 0.05 });
		const delta = computeSessionDelta(current, [...prior, current]);
		expect(delta.errorRate.verdict).toBe('up');
		expect(delta.errorRate.deltaPct).toBeNull(); // we surface null rather than Infinity
	});
});

describe('computeSessionDelta — bigram delta', () => {
	function withAggregates(
		id: string,
		aggs: Array<[string, BigramClassification]>,
		overrides: Partial<SessionSummary> = {}
	): SessionSummary {
		return makeSession({
			id,
			timestamp: overrides.timestamp ?? 0,
			bigramAggregates: aggs.map(([bigram, classification]) =>
				makeAggregate({ bigram, sessionId: id, classification })
			),
			...overrides
		});
	}

	it('counts bigrams that graduated from non-healthy to healthy', () => {
		const prev = withAggregates(
			'prev',
			[
				['th', 'acquisition'],
				['er', 'hasty'],
				['in', 'healthy']
			],
			{ timestamp: 100 }
		);
		const current = withAggregates(
			'now',
			[
				['th', 'healthy'], // graduated
				['er', 'healthy'], // graduated
				['in', 'healthy'] // already healthy — not a graduation
			],
			{ timestamp: 200 }
		);
		const delta = computeSessionDelta(current, [prev, current]);
		expect(delta.bigrams.graduatedToHealthy).toBe(2);
		expect(delta.bigrams.regressed).toBe(0);
	});

	it('counts bigrams that regressed out of healthy', () => {
		const prev = withAggregates(
			'prev',
			[
				['th', 'healthy'],
				['er', 'healthy']
			],
			{ timestamp: 100 }
		);
		const current = withAggregates(
			'now',
			[
				['th', 'hasty'], // regressed
				['er', 'healthy']
			],
			{ timestamp: 200 }
		);
		const delta = computeSessionDelta(current, [prev, current]);
		expect(delta.bigrams.regressed).toBe(1);
		expect(delta.bigrams.graduatedToHealthy).toBe(0);
	});

	it('reports zero graduations/regressions when there is no prior session', () => {
		const current = withAggregates('only', [['th', 'healthy']]);
		const delta = computeSessionDelta(current, [current]);
		expect(delta.bigrams.graduatedToHealthy).toBe(0);
		expect(delta.bigrams.regressed).toBe(0);
	});

	it('skips past prior sessions that carried no bigram data', () => {
		// An empty session between a meaningful prev and the current one — we
		// want to compare against the last session that actually had bigrams.
		const prev = withAggregates('prev', [['th', 'acquisition']], { timestamp: 100 });
		const empty = makeSession({ id: 'empty', timestamp: 150, bigramAggregates: [] });
		const current = withAggregates('now', [['th', 'healthy']], { timestamp: 200 });
		const delta = computeSessionDelta(current, [prev, empty, current]);
		expect(delta.bigrams.graduatedToHealthy).toBe(1);
	});

	it('reports distinct targeted bigrams for bigram-drill sessions', () => {
		const current = makeSession({
			type: 'bigram-drill',
			bigramsTargeted: ['th', 'er', 'th'], // duplicates collapse
			bigramAggregates: []
		});
		const delta = computeSessionDelta(current, [current]);
		expect(delta.bigrams.drilled).toBe(2);
	});

	it('falls back to distinct observed bigrams for non-drill sessions', () => {
		const current = withAggregates(
			'diag',
			[
				['th', 'healthy'],
				['er', 'hasty']
			],
			{ type: 'diagnostic', bigramsTargeted: undefined }
		);
		const delta = computeSessionDelta(current, [current]);
		expect(delta.bigrams.drilled).toBe(2);
	});
});

describe('computeSessionDelta — summary sentence', () => {
	it('reads neutrally on a first session', () => {
		const current = makeSession({ id: 'only', wpm: 65, errorRate: 0.02 });
		const delta = computeSessionDelta(current, [current]);
		expect(delta.summarySentence).toMatch(/65\.0 WPM/);
		expect(delta.summarySentence).toMatch(/first recorded session/);
		expect(delta.summarySentence).toMatch(/clean/);
	});

	it('quotes the percentage delta when above the average', () => {
		const prior = [0, 1, 2].map((i) => makeSession({ id: `p${i}`, timestamp: i, wpm: 60 }));
		const current = makeSession({ id: 'now', timestamp: 999, wpm: 72 });
		const delta = computeSessionDelta(current, [...prior, current]);
		expect(delta.summarySentence).toMatch(/20% above your 3-session average/);
	});

	it('mentions "even with" when the current matches the baseline within the flat band', () => {
		const prior = [0, 1, 2].map((i) => makeSession({ id: `p${i}`, timestamp: i, wpm: 60 }));
		const current = makeSession({ id: 'now', timestamp: 999, wpm: 60 });
		const delta = computeSessionDelta(current, [...prior, current]);
		expect(delta.summarySentence).toMatch(/even with your 3-session average/);
	});

	it('calls out the floor when the error rate is above it', () => {
		const current = makeSession({ wpm: 60, errorRate: 0.1 });
		const delta = computeSessionDelta(current, [current]);
		expect(delta.summarySentence).toMatch(/10\.0% errors — above the 5% floor/);
	});

	it('appends a graduations clause when any bigrams graduated', () => {
		const prev = makeSession({
			id: 'prev',
			timestamp: 100,
			bigramAggregates: [
				makeAggregate({ bigram: 'th', sessionId: 'prev', classification: 'acquisition' })
			]
		});
		const current = makeSession({
			id: 'now',
			timestamp: 200,
			bigramAggregates: [
				makeAggregate({ bigram: 'th', sessionId: 'now', classification: 'healthy' })
			]
		});
		const delta = computeSessionDelta(current, [prev, current]);
		expect(delta.summarySentence).toMatch(/1 bigram graduated to healthy/);
	});

	it('pluralizes the graduations clause', () => {
		const prev = makeSession({
			id: 'prev',
			timestamp: 100,
			bigramAggregates: [
				makeAggregate({ bigram: 'th', sessionId: 'prev', classification: 'acquisition' }),
				makeAggregate({ bigram: 'er', sessionId: 'prev', classification: 'hasty' })
			]
		});
		const current = makeSession({
			id: 'now',
			timestamp: 200,
			bigramAggregates: [
				makeAggregate({ bigram: 'th', sessionId: 'now', classification: 'healthy' }),
				makeAggregate({ bigram: 'er', sessionId: 'now', classification: 'healthy' })
			]
		});
		const delta = computeSessionDelta(current, [prev, current]);
		expect(delta.summarySentence).toMatch(/2 bigrams graduated to healthy/);
	});
});
