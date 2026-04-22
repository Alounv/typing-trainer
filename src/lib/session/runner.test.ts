import { describe, expect, it } from 'vitest';
import { buildSessionSummary, SessionRunner } from './runner';
import type { KeystrokeEvent } from '../core';

/**
 * Fixed id + timestamp so snapshots of the output are stable without pinning
 * the whole summary — lets each test assert precisely the fields it cares about.
 */
const FIXED_ID = 'test-session-1';
const FIXED_TS = 1_700_000_000_000;

function makeInput(overrides: Partial<Parameters<typeof buildSessionSummary>[0]> = {}) {
	return {
		events: [] as readonly KeystrokeEvent[],
		type: 'diagnostic' as const,
		textLength: 0,
		durationMs: 0,
		idGenerator: () => FIXED_ID,
		timestampProvider: () => FIXED_TS,
		...overrides
	};
}

/** Minimal helper — keystroke synthesis only needs position-adjacent events. */
function stroke(
	position: number,
	expected: string,
	actual: string,
	timestamp: number
): KeystrokeEvent {
	return { position, expected, actual, timestamp, wordIndex: 0, positionInWord: position };
}

describe('buildSessionSummary', () => {
	it('passes through id and timestamp from injectors', () => {
		const summary = buildSessionSummary(makeInput());
		expect(summary.id).toBe(FIXED_ID);
		expect(summary.timestamp).toBe(FIXED_TS);
	});

	it('raw WPM uses textLength / 5 / minutes, not event count', () => {
		// 30 chars in 6 seconds = 6 words in 0.1 minute = 60 WPM, regardless of
		// how many retypes the user fired along the way.
		const summary = buildSessionSummary(
			makeInput({ textLength: 30, durationMs: 6_000, events: [] })
		);
		expect(summary.wpm).toBe(60);
	});

	it('returns wpm=0 for zero-duration session', () => {
		// Avoids NaN/Infinity poisoning the progress store on aborted sessions.
		const summary = buildSessionSummary(makeInput({ textLength: 10, durationMs: 0 }));
		expect(summary.wpm).toBe(0);
	});

	it('errorRate counts first-input wrongs only; retypes do not rescue', () => {
		// Position 0: wrong first input, then retyped correctly.
		// Position 1: correct first input.
		const events = [stroke(0, 'a', 'b', 0), stroke(0, 'a', 'a', 100), stroke(1, 'b', 'b', 200)];
		const summary = buildSessionSummary(makeInput({ events, textLength: 2, durationMs: 1_000 }));
		// 1 wrong out of 2 positions — first-input sticks.
		expect(summary.errorRate).toBe(0.5);
	});

	it('bigramAggregates carry the session id and reflect the event stream', () => {
		// "ab" typed cleanly twice at consecutive positions → one bigram, 2 occ.
		const events = [
			stroke(0, 'a', 'a', 0),
			stroke(1, 'b', 'b', 100),
			stroke(2, 'a', 'a', 200),
			stroke(3, 'b', 'b', 300)
		];
		const summary = buildSessionSummary(makeInput({ events, textLength: 4, durationMs: 1_000 }));
		const ab = summary.bigramAggregates.find((b) => b.bigram === 'ab');
		expect(ab).toBeDefined();
		expect(ab!.sessionId).toBe(FIXED_ID);
		// 2 clean occurrences (positions 0→1, 2→3); position 1→2 is "ba".
		expect(ab!.occurrences).toBe(2);
	});

	it('preserves bigramsTargeted for drill-type sessions', () => {
		const summary = buildSessionSummary(
			makeInput({ type: 'bigram-drill', bigramsTargeted: ['th', 'he'] })
		);
		expect(summary.bigramsTargeted).toEqual(['th', 'he']);
	});
});

describe('SessionRunner', () => {
	it('accumulates events and advances position', () => {
		const runner = new SessionRunner({ type: 'diagnostic', text: 'abc' });
		runner.recordEvent(stroke(0, 'a', 'a', 100));
		runner.recordEvent(stroke(1, 'b', 'b', 200));
		expect(runner.events).toHaveLength(2);
		expect(runner.position).toBe(2);
	});

	it('isComplete flips to true once every position is typed', () => {
		const runner = new SessionRunner({ type: 'diagnostic', text: 'ab' });
		runner.recordEvent(stroke(0, 'a', 'a', 0));
		expect(runner.isComplete()).toBe(false);
		runner.recordEvent(stroke(1, 'b', 'b', 100));
		expect(runner.isComplete()).toBe(true);
	});

	it('preserves targetBigrams through finalize for drill summaries', () => {
		// Targets are recorded on the summary for cross-session analysis,
		// even though the runner itself no longer does anything with them.
		const runner = new SessionRunner({
			type: 'bigram-drill',
			text: 'ab',
			targetBigrams: ['ab']
		});
		runner.recordEvent(stroke(0, 'a', 'a', 0));
		runner.recordEvent(stroke(1, 'b', 'b', 100));
		const r = runner.finalize(1000);
		expect(r.bigramsTargeted).toEqual(['ab']);
	});

	it('finalize produces a summary with the accumulated events', () => {
		const runner = new SessionRunner({
			type: 'bigram-drill',
			text: 'ab',
			targetBigrams: ['ab'],
			idGenerator: () => FIXED_ID,
			timestampProvider: () => FIXED_TS
		});
		runner.recordEvent(stroke(0, 'a', 'a', 0));
		runner.recordEvent(stroke(1, 'b', 'b', 500));
		const summary = runner.finalize(1_000);
		expect(summary.id).toBe(FIXED_ID);
		expect(summary.bigramsTargeted).toEqual(['ab']);
		expect(summary.durationMs).toBe(1_000);
		// 2-char text / 5 / (1 / 60) = 24 WPM.
		expect(summary.wpm).toBeCloseTo(24, 5);
	});
});
