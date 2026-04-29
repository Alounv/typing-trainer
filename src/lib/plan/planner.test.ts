import { describe, expect, it } from 'vitest';
import { planDailySessions } from './planner';
import { planSlotKey } from './types';
import type { PriorityBigram, SessionSummary, UserSettings } from '../support/core';

function diagnosticToday(): SessionSummary {
	return {
		id: 'diag',
		timestamp: Date.now(),
		type: 'diagnostic',
		durationMs: 60_000,
		wpm: 50,
		errorRate: 0.02,
		bigramAggregates: []
	};
}

function priority(
	bigram: string,
	classification: PriorityBigram['classification']
): PriorityBigram {
	return { bigram, score: 1, meanTime: 200, errorRate: 0.1, classification };
}

describe('planDailySessions — plan structure overrides', () => {
	const baseInput = {
		statsSessions: [diagnosticToday()],
		accuracyPriorityTargets: [priority('th', 'hasty')],
		speedPriorityTargets: [priority('er', 'fluency')],
		undertrainedBigrams: [] as string[]
	};

	it('uses default cycles/drills when planStructure is absent', () => {
		const plan = planDailySessions(baseInput);
		const counts = countByKey(plan);
		// Default: 2 cycles × (2 accuracy + 2 speed) = 4 each, plus 2 real-text.
		expect(counts['bigram-drill/accuracy']).toBe(4);
		expect(counts['bigram-drill/speed']).toBe(4);
		expect(counts['real-text']).toBe(2);
	});

	it('honours user-supplied cycles and per-mode reps', () => {
		const userSettings: UserSettings = {
			language: 'en',
			planStructure: { cyclesPerDay: 3, accuracyDrillsPerCycle: 1, speedDrillsPerCycle: 4 }
		};
		const plan = planDailySessions({ ...baseInput, userSettings });
		const counts = countByKey(plan);
		expect(counts['bigram-drill/accuracy']).toBe(3);
		expect(counts['bigram-drill/speed']).toBe(12);
		expect(counts['real-text']).toBe(3);
	});

	it('drops a mode entirely when its per-cycle count is zero', () => {
		const userSettings: UserSettings = {
			language: 'en',
			planStructure: { cyclesPerDay: 2, accuracyDrillsPerCycle: 0, speedDrillsPerCycle: 2 }
		};
		const plan = planDailySessions({ ...baseInput, userSettings });
		const counts = countByKey(plan);
		expect(counts['bigram-drill/accuracy']).toBe(0);
		expect(counts['bigram-drill/speed']).toBe(4);
	});

	it('falls back to defaults for missing leaves on planStructure', () => {
		// `planStructure` is typed strictly, but stored profiles may pre-date a
		// field. Cast through a partial shape to mimic that legacy state.
		const userSettings = {
			language: 'en',
			planStructure: { cyclesPerDay: 4 }
		} as unknown as UserSettings;
		const plan = planDailySessions({ ...baseInput, userSettings });
		const counts = countByKey(plan);
		expect(counts['real-text']).toBe(4);
		// Defaults still apply for accuracy/speed: 2 each per cycle × 4 cycles.
		expect(counts['bigram-drill/accuracy']).toBe(8);
		expect(counts['bigram-drill/speed']).toBe(8);
	});
});

function countByKey(plan: ReturnType<typeof planDailySessions>) {
	const counts: Record<string, number> = {
		'bigram-drill/accuracy': 0,
		'bigram-drill/speed': 0,
		'real-text': 0,
		diagnostic: 0
	};
	for (const item of plan) counts[planSlotKey(item.config)]++;
	return counts;
}
