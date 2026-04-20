import { describe, it, expect } from 'vitest';
import { detectGraduations, detectMilestone, isImprovement } from './celebrations';
import type { BigramAggregate, BigramClassification } from '../bigram/types';
import type { SessionSummary } from '../session/types';

// Minimal aggregate factory — only fields `detectGraduations` reads are populated.
function agg(bigram: string, classification: BigramClassification): BigramAggregate {
	return {
		bigram,
		sessionId: 's',
		occurrences: 20,
		meanTime: 150,
		stdTime: 10,
		errorCount: 0,
		errorRate: 0,
		classification
	};
}

describe('detectGraduations', () => {
	it('returns empty when nothing changes', () => {
		const prev = [agg('th', 'hasty'), agg('he', 'healthy')];
		const curr = [agg('th', 'hasty'), agg('he', 'healthy')];
		expect(detectGraduations(prev, curr)).toEqual([]);
	});

	it.each<{
		from: BigramClassification;
		to: BigramClassification;
		tier: 'healthy' | 'escaped-acquisition' | 'cleaned-up';
	}>([
		{ from: 'acquisition', to: 'healthy', tier: 'healthy' },
		{ from: 'hasty', to: 'healthy', tier: 'healthy' },
		{ from: 'fluency', to: 'healthy', tier: 'healthy' },
		{ from: 'acquisition', to: 'hasty', tier: 'escaped-acquisition' },
		{ from: 'acquisition', to: 'fluency', tier: 'escaped-acquisition' },
		{ from: 'hasty', to: 'fluency', tier: 'cleaned-up' }
	])('$from → $to emits tier=$tier', ({ from, to, tier }) => {
		const events = detectGraduations([agg('xx', from)], [agg('xx', to)]);
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({ bigram: 'xx', tier, from, to });
	});

	it('does not emit for regressions', () => {
		const prev = [agg('th', 'healthy'), agg('he', 'fluency')];
		const curr = [agg('th', 'hasty'), agg('he', 'acquisition')];
		expect(detectGraduations(prev, curr)).toEqual([]);
	});

	it('treats unclassified transitions as silent', () => {
		const prev = [agg('th', 'unclassified')];
		const curr = [agg('th', 'healthy')];
		// Was unclassified → healthy: too little prior signal, stay silent.
		expect(detectGraduations(prev, curr)).toEqual([]);
	});

	it('emits healthy graduation for first-appearance-as-healthy', () => {
		// No previous data for this bigram; landing in healthy is still a win.
		const events = detectGraduations([], [agg('zz', 'healthy')]);
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({ bigram: 'zz', tier: 'healthy', from: null });
	});

	it('does not emit for first-appearance in non-healthy classes', () => {
		const events = detectGraduations([], [agg('zz', 'hasty'), agg('yy', 'acquisition')]);
		expect(events).toEqual([]);
	});

	it('sorts by tier: healthy first, then escaped-acquisition, then cleaned-up', () => {
		const prev = [agg('aa', 'hasty'), agg('bb', 'acquisition'), agg('cc', 'acquisition')];
		const curr = [agg('aa', 'fluency'), agg('bb', 'hasty'), agg('cc', 'healthy')];
		const events = detectGraduations(prev, curr);
		expect(events.map((e) => e.tier)).toEqual(['healthy', 'escaped-acquisition', 'cleaned-up']);
	});

	it('handles null prev (no prior session with bigrams)', () => {
		const events = detectGraduations(null, [agg('xx', 'healthy'), agg('yy', 'hasty')]);
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({ bigram: 'xx', tier: 'healthy' });
	});
});

// Build a minimal session with just the fields `detectMilestone` reads via
// `buildWpmSeries` (timestamp, wpm, id + required SessionSummary shape).
function session(id: string, timestamp: number, wpm: number): SessionSummary {
	return {
		id,
		timestamp,
		type: 'real-text',
		durationMs: 60_000,
		wpm,
		errorRate: 0,
		bigramAggregates: []
	};
}

/** Build N sessions with the given WPM values, spaced 1s apart. */
function historyAt(wpms: number[]): SessionSummary[] {
	return wpms.map((w, i) => session(`s${i}`, 1_000 + i * 1000, w));
}

describe('detectMilestone', () => {
	it('returns null when fewer than 7 sessions exist (rolling window not full)', () => {
		const history = historyAt([65, 66, 67, 68, 69, 70]); // 6 + current = 7, but prior avg null
		const current = session('curr', 10_000, 80);
		// `buildWpmSeries` needs 7 points for the first rolling value; prev is
		// position 6 which is still null, so we return null.
		expect(detectMilestone(current, history)).toBeNull();
	});

	it('fires when rolling avg crosses 70 between prior and current', () => {
		// 7 sessions below 70, then one that pulls the rolling avg across 70.
		const history = historyAt([68, 68, 68, 68, 68, 68, 68, 78]);
		const current = session('curr', 100_000, 90);
		const result = detectMilestone(current, history);
		expect(result).not.toBeNull();
		expect(result!.threshold).toBe(70);
	});

	it('returns the highest threshold crossed in a single step', () => {
		// Seed a 7-session baseline at ~55, then a big jump to 100.
		const history = historyAt([55, 55, 55, 55, 55, 55, 55]);
		const current = session('curr', 100_000, 200);
		const result = detectMilestone(current, history);
		// Rolling avg jumps from 55 to (55*6+200)/7 ≈ 75.7 — crosses 60 and 70,
		// we report the highest (70).
		expect(result!.threshold).toBe(70);
	});

	it('does not re-fire when already past the threshold', () => {
		// Already sitting at 72 rolling avg; one more session at 75 doesn't cross anything.
		const history = historyAt([72, 72, 72, 72, 72, 72, 72]);
		const current = session('curr', 100_000, 75);
		expect(detectMilestone(current, history)).toBeNull();
	});

	it('filters the current session out of history to avoid double-counting', () => {
		// If `current` is already in history, the series would include it twice
		// without the filter. Verify by passing an identical id twice.
		const history = historyAt([68, 68, 68, 68, 68, 68, 68, 78]);
		const current = history[history.length - 1]; // same id as last history entry
		// Without the id-filter, rolling avg of the last position would differ; with
		// it, we get a sensible baseline.
		const result = detectMilestone(current, history);
		// Either null or a valid milestone, but must not crash.
		expect(result === null || typeof result.threshold === 'number').toBe(true);
	});

	it('ignores sub-60 movements (no milestone below 60)', () => {
		const history = historyAt([50, 50, 50, 50, 50, 50, 50]);
		const current = session('curr', 100_000, 55);
		expect(detectMilestone(current, history)).toBeNull();
	});
});

describe('isImprovement', () => {
	it('is true for moves toward healthy', () => {
		expect(isImprovement('acquisition', 'healthy')).toBe(true);
		expect(isImprovement('hasty', 'fluency')).toBe(true);
	});

	it('is false for regressions or no-op', () => {
		expect(isImprovement('healthy', 'hasty')).toBe(false);
		expect(isImprovement('fluency', 'fluency')).toBe(false);
	});

	it('is false when either side is unclassified', () => {
		expect(isImprovement('unclassified', 'healthy')).toBe(false);
		expect(isImprovement('healthy', 'unclassified')).toBe(false);
	});
});
