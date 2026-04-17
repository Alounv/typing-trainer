import { describe, expect, it } from 'vitest';
import { buildSessionSummary } from './runner';
import type { KeystrokeEvent } from '../typing/types';

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
		const events = [
			stroke(0, 'a', 'b', 0),
			stroke(0, 'a', 'a', 100),
			stroke(1, 'b', 'b', 200)
		];
		const summary = buildSessionSummary(
			makeInput({ events, textLength: 2, durationMs: 1_000 })
		);
		// 1 wrong out of 2 positions — spec §2.2 first-input-sticks.
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
		const summary = buildSessionSummary(
			makeInput({ events, textLength: 4, durationMs: 1_000 })
		);
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
