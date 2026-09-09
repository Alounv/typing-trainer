import { describe, expect, it } from 'vitest';
import { summarizeBigrams } from '$lib/skill';
import { DEFAULT_THRESHOLDS, RECENT_WINDOW } from '$lib/support/core';
import type { SessionSummary, BigramAggregate, BigramSample } from '$lib/support/core';
import type { FrequencyTable } from '$lib/corpus';
// One level in: movement detection is what the summary page is built around,
// and `progress` exposes only components, so there is no barrel to go through.
import { detectMilestone, detectWindowedMovements } from './celebrations';

const PAIRS = ['th', 'he', 'in', 'er', 'an', 're', 'on', 'at', 'en', 'nd'];

function samples(n: number, timing: number, errEvery: number): BigramSample[] {
	return Array.from({ length: n }, (_, k) => ({
		timing,
		correct: errEvery === 0 ? true : k % errEvery !== 0
	})) as BigramSample[];
}

/**
 * Sessions 0-8 are slow and sloppy. Session 9 is fast, clean, and long enough
 * (24 samples) to fill the 20-sample rolling window on its own — so including
 * it flips every bigram's class, which is exactly what a movement is.
 */
function session(i: number): SessionSummary {
	const improving = i === 9;
	const n = improving ? 24 : 8;
	const aggs: BigramAggregate[] = PAIRS.map((bigram, b) => ({
		bigram,
		sessionId: `s${i}`,
		occurrences: n,
		errorCount: improving ? 0 : 2,
		meanTime: improving ? 90 + b : 320 + b,
		errorRate: improving ? 0 : 0.25,
		classification: 'unclassified',
		samples: samples(n, improving ? 90 + b : 320 + b, improving ? 0 : 4)
	})) as BigramAggregate[];
	return {
		id: `s${i}`,
		timestamp: i * 1000,
		type: 'real-text',
		durationMs: 60000,
		wpm: 40 + i * 4,
		errorRate: improving ? 0.01 : 0.08,
		bigramAggregates: aggs
	} as SessionSummary;
}

describe('detectWindowedMovements', () => {
	// The summary page hands in the same rows its bigram table renders, which are
	// corpus-weighted. That is only safe because weighting moves `frequency` and
	// `priorityScore` and never `classification` — pin it, or a later change that
	// reads a weighted field here would go unnoticed.
	it('reads only what corpus weighting cannot change', () => {
		const sessions = Array.from({ length: 10 }, (_, i) => session(i));
		const current = sessions[sessions.length - 1];
		const freq: FrequencyTable = Object.fromEntries(PAIRS.map((p, i) => [p, (i + 1) * 0.01]));

		// What the old code computed internally: unweighted.
		const unweighted = summarizeBigrams(sessions, undefined, DEFAULT_THRESHOLDS);
		// What the new code passes in: the table's corpus-weighted rows.
		const weighted = summarizeBigrams(sessions, freq, DEFAULT_THRESHOLDS);

		const before = detectWindowedMovements(unweighted, sessions, current.id, DEFAULT_THRESHOLDS);
		const after = detectWindowedMovements(weighted, sessions, current.id, DEFAULT_THRESHOLDS);

		expect(before.length).toBeGreaterThan(0); // else the comparison proves nothing
		expect(after).toEqual(before);
	});
});

const wpmSession = (i: number, wpm: number) =>
	({
		id: `s${i}`,
		timestamp: i * 1000,
		type: 'real-text',
		durationMs: 60_000,
		wpm,
		errorRate: 0.02,
		bigramAggregates: []
	}) as SessionSummary;

describe('detectMilestone', () => {
	const W = RECENT_WINDOW;
	const SLOW = 45;
	const FAST = 95;

	// W slow sessions, then fast ones. Each fast session entering the window
	// lifts the mean by (FAST - SLOW)/W, so the mean reaches 60 once k fast
	// sessions are in it:  (SLOW(W-k) + FAST·k)/W = 60  →  k = 0.3W.
	// That happens at index W + k - 1.
	const CROSSES_AT = Math.round(W * 1.3) - 1;

	const climb = (n: number) =>
		Array.from({ length: n }, (_, i) => wpmSession(i, i < W ? SLOW : FAST));

	const history = climb(CROSSES_AT + 1);

	it('awards the badge to the session that earned it', () => {
		expect(detectMilestone(history[CROSSES_AT], history)?.threshold).toBe(60);
	});

	// The series is chronological, so reading its last point reports on the
	// newest session on file rather than the one whose summary is open.
	it('awards nothing when an older, unremarkable session is opened', () => {
		expect(detectMilestone(history[2], history)).toBeNull();
	});

	it('awards a threshold once, even if the average dips back under and recovers', () => {
		// A slump long enough to drag the mean under 60, then a recovery long
		// enough to lift it back over. The badge belongs to the first crossing.
		const next = (from: number, n: number, wpm: number) =>
			Array.from({ length: n }, (_, i) => wpmSession(from + i, wpm));
		const dipAndRecover = [
			...history,
			...next(history.length, W, 20),
			...next(history.length + W, W, FAST)
		];
		const earned = dipAndRecover.filter((s) => detectMilestone(s, dipAndRecover)?.threshold === 60);
		expect(earned.map((s) => s.id)).toEqual([`s${CROSSES_AT}`]);
	});
});
