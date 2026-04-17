import { describe, expect, it } from 'vitest';
import {
	planDailySessions,
	sliceCompletedFromPlan,
	DIAGNOSTIC_INTERVAL,
	DEFAULT_DRILL_TARGET_COUNT,
	PAIRS_PER_DAY
} from './planner';
import { DEFAULT_BIGRAM_DRILL_WORD_BUDGET, DEFAULT_REAL_TEXT_WORD_BUDGET } from '../models';
import type { SessionSummary, SessionType } from '../session/types';
import type { DiagnosticReport, PriorityBigram } from '../diagnostic/types';

/**
 * Test helpers. Keep them minimal: the planner only reads `type` and
 * `timestamp` from sessions; anything else is noise.
 */
function session(type: SessionType, ts = 0): SessionSummary {
	return {
		id: `${type}-${ts}`,
		timestamp: ts,
		type,
		durationMs: 0,
		wpm: 0,
		errorRate: 0,
		bigramAggregates: []
	};
}

/** Shortcut: build a session list newest-first (matches storage ordering). */
function recent(...types: SessionType[]): SessionSummary[] {
	// Timestamps descend so the list reads as "most recent at index 0".
	return types.map((t, i) => session(t, types.length - i));
}

function priorityTarget(bigram: string): PriorityBigram {
	return { bigram, score: 1, meanTime: 300, errorRate: 0 };
}

function report(priorityBigrams: string[]): DiagnosticReport {
	return {
		sessionId: 'diag-1',
		timestamp: 0,
		baselineWPM: 60,
		targetWPM: 70,
		counts: { healthy: 0, fluency: 0, hasty: 0, acquisition: 0 },
		topBottlenecks: { fluency: [], hasty: [], acquisition: [] },
		priorityTargets: priorityBigrams.map(priorityTarget),
		corpusFit: { coverageRatio: 1, undertrained: [] }
	};
}

describe('planDailySessions — diagnostic triggers', () => {
	it('first-run: empty history → single diagnostic', () => {
		const plan = planDailySessions({ recentSessions: [] });
		expect(plan).toHaveLength(1);
		expect(plan[0].config.type).toBe('diagnostic');
		expect(plan[0].reason).toBe('first-run-diagnostic');
	});

	it('history exists but no diagnostic report → fallback diagnostic', () => {
		const plan = planDailySessions({
			recentSessions: recent('real-text', 'bigram-drill')
		});
		expect(plan).toHaveLength(1);
		expect(plan[0].reason).toBe('missing-report-diagnostic');
	});

	/**
	 * Cadence boundary: `DIAGNOSTIC_INTERVAL` non-diagnostic sessions since
	 * the last diagnostic is the trigger. At interval-1 we keep drilling;
	 * at interval (or beyond) we re-diagnose.
	 */
	it.each`
		sessionsSince              | shouldDiagnose
		${DIAGNOSTIC_INTERVAL - 1} | ${false}
		${DIAGNOSTIC_INTERVAL}     | ${true}
		${DIAGNOSTIC_INTERVAL + 3} | ${true}
	`(
		'$sessionsSince non-diag sessions since last diagnostic → diagnose? $shouldDiagnose',
		({ sessionsSince, shouldDiagnose }: { sessionsSince: number; shouldDiagnose: boolean }) => {
			// Build: [N × real-text], then a diagnostic (newest first in list).
			const types: SessionType[] = [
				...(Array(sessionsSince).fill('real-text') as SessionType[]),
				'diagnostic'
			];
			const plan = planDailySessions({
				recentSessions: recent(...types),
				latestDiagnosticReport: report(['th', 'he'])
			});
			if (shouldDiagnose) {
				expect(plan[0].reason).toBe('cadence-diagnostic');
				expect(plan[0].config.type).toBe('diagnostic');
			} else {
				expect(plan[0].reason).toBe('default-drill');
			}
		}
	);
});

describe('planDailySessions — default daily structure', () => {
	it('mid-cycle: interleaves drill + real-text mini-sessions', () => {
		const plan = planDailySessions({
			recentSessions: recent('real-text', 'diagnostic'),
			latestDiagnosticReport: report(['th', 'he', 'in'])
		});
		// Full day = PAIRS_PER_DAY × [drill, real-text].
		expect(plan).toHaveLength(PAIRS_PER_DAY * 2);
		const types = plan.map((p) => p.config.type);
		for (let i = 0; i < PAIRS_PER_DAY; i++) {
			expect(types[i * 2]).toBe('bigram-drill');
			expect(types[i * 2 + 1]).toBe('real-text');
		}
		expect(plan[0].config.wordBudget).toBe(DEFAULT_BIGRAM_DRILL_WORD_BUDGET);
		expect(plan[1].config.wordBudget).toBe(DEFAULT_REAL_TEXT_WORD_BUDGET);
	});

	it('drill uses top priority bigrams up to the default count', () => {
		// 15 targets; default cap trims to 10.
		const targets = Array.from({ length: 15 }, (_, i) => `b${i}`);
		const plan = planDailySessions({
			recentSessions: recent('diagnostic'),
			latestDiagnosticReport: report(targets)
		});
		expect(plan[0].config.bigramsTargeted).toHaveLength(DEFAULT_DRILL_TARGET_COUNT);
		expect(plan[0].config.bigramsTargeted?.[0]).toBe('b0');
	});

	it('drill target count override is honored', () => {
		const plan = planDailySessions({
			recentSessions: recent('diagnostic'),
			latestDiagnosticReport: report(['a', 'b', 'c', 'd']),
			drillTargetCount: 2
		});
		expect(plan[0].config.bigramsTargeted).toEqual(['a', 'b']);
	});

	it('graduated bigrams are stripped from drill targets, order preserved', () => {
		const plan = planDailySessions({
			recentSessions: recent('diagnostic'),
			latestDiagnosticReport: report(['th', 'he', 'in', 'er']),
			graduatedFromRotation: new Set(['he', 'er'])
		});
		expect(plan[0].config.bigramsTargeted).toEqual(['th', 'in']);
	});

	it('all priority targets graduated → skip drill, emit real-text only', () => {
		const plan = planDailySessions({
			recentSessions: recent('diagnostic'),
			latestDiagnosticReport: report(['th', 'he']),
			graduatedFromRotation: new Set(['th', 'he'])
		});
		// Still PAIRS_PER_DAY mini-sessions — just all real-text, no drill.
		expect(plan).toHaveLength(PAIRS_PER_DAY);
		expect(plan.every((p) => p.config.type === 'real-text')).toBe(true);
	});
});

describe('planDailySessions — session config shape', () => {
	it('diagnostic session has no targeted bigrams', () => {
		const plan = planDailySessions({ recentSessions: [] });
		expect(plan[0].config.bigramsTargeted).toBeUndefined();
	});
});

describe('sliceCompletedFromPlan', () => {
	/**
	 * Build a canonical interleaved daily plan to slice against. Uses the
	 * real planner so the test reflects the actual shape the dashboard sees
	 * (drill/real-text/drill/real-text/...).
	 */
	function dailyPlan() {
		return planDailySessions({
			recentSessions: recent('diagnostic'),
			latestDiagnosticReport: report(['th'])
		});
	}

	it('returns the full plan when nothing has been completed today', () => {
		const full = dailyPlan();
		const remaining = sliceCompletedFromPlan(full, {});
		expect(remaining).toHaveLength(full.length);
		expect(remaining[0]).toBe(full[0]);
	});

	/**
	 * The interleaved order is [drill, real-text, drill, real-text, …].
	 * "2 drills + 0 real-text done" chews through the first drill, keeps
	 * the first real-text, chews through the second drill. Net: we drop
	 * the two earliest drill slots while the real-text slots in between
	 * survive, so 6 items remain.
	 */
	it.each`
		drillsDone | realTextDone | expectedRemaining
		${1}       | ${0}         | ${PAIRS_PER_DAY * 2 - 1}
		${2}       | ${0}         | ${PAIRS_PER_DAY * 2 - 2}
		${2}       | ${2}         | ${PAIRS_PER_DAY * 2 - 4}
		${4}       | ${4}         | ${0}
	`(
		'$drillsDone drills + $realTextDone real-text done → $expectedRemaining remaining',
		({ drillsDone, realTextDone, expectedRemaining }) => {
			const full = dailyPlan();
			const remaining = sliceCompletedFromPlan(full, {
				'bigram-drill': drillsDone,
				'real-text': realTextDone
			});
			expect(remaining).toHaveLength(expectedRemaining);
		}
	);

	it('preserves interleaving order of surviving items', () => {
		// 1 drill + 0 real-text done → first survivor is the initial real-text,
		// then drill, real-text, drill, real-text, drill, real-text.
		const full = dailyPlan();
		const remaining = sliceCompletedFromPlan(full, { 'bigram-drill': 1 });
		expect(remaining[0].config.type).toBe('real-text');
		expect(remaining[1].config.type).toBe('bigram-drill');
	});

	it('does not consume credits across unrelated session types', () => {
		// A diagnostic-day plan is a single diagnostic item; completing a
		// drill earlier in the day shouldn't mark it done.
		const diagPlan = planDailySessions({ recentSessions: [] });
		const remaining = sliceCompletedFromPlan(diagPlan, { 'bigram-drill': 3 });
		expect(remaining).toEqual(diagPlan);
	});
});
