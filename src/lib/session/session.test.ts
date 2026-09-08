import { describe, expect, it } from 'vitest';
import { SessionRunner } from './runner';
import { buildDifficultyMap } from './bigramDifficulty';
import type { BigramSummary } from '../skill';
import type { KeystrokeEvent } from '../support/core';

function event(
	position: number,
	expected: string,
	actual: string,
	timestamp: number
): KeystrokeEvent {
	return { timestamp, expected, actual, position, wordIndex: 0, positionInWord: position };
}

/** Types `typed` against `expected`, one event per position, 100ms apart. */
function run(expected: string, typed: string, elapsedMs = 60_000) {
	const runner = new SessionRunner({
		type: 'real-text',
		text: expected,
		idGenerator: () => 'fixed-id',
		timestampProvider: () => 1_000
	});
	for (let i = 0; i < typed.length; i++) {
		runner.recordEvent(event(i, expected[i], typed[i], i * 100));
	}
	return { runner, session: runner.finalize(elapsedMs) };
}

describe('SessionRunner', () => {
	it('stores the text and the keystroke stream, and no aggregates', () => {
		const { session } = run('the cat', 'the cat');

		expect(session.text).toBe('the cat');
		expect(session.stream?.typed).toBe('the cat');
		expect(session.stream?.positions).toBeInstanceOf(Int16Array);
		// Aggregates are a reading of the stream, measured on load.
		expect(session.bigramAggregates).toBeUndefined();
	});

	it('rates WPM off the prompt length, not the keystroke count', () => {
		// An abandoned run types fewer chars than the prompt. Counting events
		// would call that a normal-speed session over a shorter text.
		const full = run('the cat sat', 'the cat sat').session;
		const abandoned = run('the cat sat', 'the').session;

		expect(abandoned.wpm).toBe(full.wpm);
		expect(full.wpm).toBeCloseTo(11 / 5, 5);
	});

	it('counts an error once, however many times the position is retyped', () => {
		const runner = new SessionRunner({ type: 'real-text', text: 'ab' });
		runner.recordEvent(event(0, 'a', 'x', 0)); // wrong
		runner.recordEvent(event(0, 'a', 'a', 100)); // retyped correctly
		runner.recordEvent(event(1, 'b', 'b', 200));

		// First input is what counts: 1 wrong out of 2 positions.
		expect(runner.finalize(60_000).errorRate).toBeCloseTo(0.5, 5);
	});

	it('completes on the last position, not on the event count', () => {
		const runner = new SessionRunner({ type: 'real-text', text: 'ab' });
		runner.recordEvent(event(0, 'a', 'x', 0));
		runner.recordEvent(event(0, 'a', 'a', 100));
		expect(runner.isComplete()).toBe(false);
		runner.recordEvent(event(1, 'b', 'b', 200));
		expect(runner.isComplete()).toBe(true);
	});

	it('reports zero WPM for a zero-duration session rather than infinity', () => {
		expect(run('ab', 'ab', 0).session.wpm).toBe(0);
	});
});

describe('buildDifficultyMap', () => {
	function summary(overrides: Partial<BigramSummary>): BigramSummary {
		return {
			bigram: 'th',
			classification: 'healthy',
			meanTime: 150,
			errorRate: 0,
			occurrences: 20,
			timeLostPerOccurrence: 0,
			...overrides
		} as BigramSummary;
	}

	it('scores the error tint by error rate against the ceiling', () => {
		const map = buildDifficultyMap(
			[summary({ bigram: 'th', errorRate: 0.05 }), summary({ bigram: 'er', errorRate: 0.1 })],
			'errors'
		);
		expect(map.get('th')).toBeCloseTo(0.5, 5);
		// At and past the ceiling the tint is full — a 40% error rate is not
		// four times as red as 10%.
		expect(map.get('er')).toBe(1);
	});

	it('scores the pace tint by rank, so only the draggiest pop', () => {
		const map = buildDifficultyMap(
			[
				summary({ bigram: 'aa', meanTime: 100 }),
				summary({ bigram: 'bb', meanTime: 200 }),
				summary({ bigram: 'cc', meanTime: 300 })
			],
			'speed'
		);
		expect(map.get('aa')).toBe(0);
		expect(map.get('cc')).toBe(1);
		// The middle of three is ranked at 0.5, and the quartic curve keeps it
		// nearly untinted rather than half-tinted.
		expect(map.get('bb')).toBeLessThan(0.1);
	});

	it.each(['errors', 'speed'] as const)(
		'leaves unclassified bigrams untinted in %s mode',
		(mode) => {
			// Under the occurrence floor there is no evidence to tint with, and a
			// guessed tint would send the eye to the wrong place.
			const map = buildDifficultyMap(
				[summary({ bigram: 'zq', classification: 'unclassified', errorRate: 0.5, meanTime: 900 })],
				mode
			);
			expect(map.has('zq')).toBe(false);
		}
	);
});
