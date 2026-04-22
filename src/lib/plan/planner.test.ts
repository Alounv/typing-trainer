import { describe, expect, it } from 'vitest';
import {
	planDailySessions as planDailySessionsRaw,
	sliceCompletedFromPlan,
	selectAccuracyDrillMix,
	selectSpeedDrillMix,
	DIAGNOSTIC_INTERVAL,
	DEFAULT_DRILL_TARGET_COUNT,
	CYCLES_PER_DAY
} from './planner';
import {
	DEFAULT_BIGRAM_DRILL_WORD_BUDGET,
	DEFAULT_REAL_TEXT_WORD_BUDGET
} from '../settings/defaults';
import type { SessionSummary, SessionType, PriorityBigram } from '../core/types';
import type { SchedulerInput } from './types';

/**
 * Fixture shape for test wrapper input. `DiagnosticReport` is now just
 * `{ baselineWPM }`, so it's no longer a useful carrier for planner-relevant
 * fields. Tests keep expressing intent via these two lists and the wrapper
 * splits `priorityTargets` by classification.
 */
interface PlannerFixture {
	priorityTargets: PriorityBigram[];
	undertrained: string[];
}

type TestInput = Omit<
	SchedulerInput,
	'accuracyPriorityTargets' | 'speedPriorityTargets' | 'undertrainedBigrams'
> &
	Partial<
		Pick<SchedulerInput, 'accuracyPriorityTargets' | 'speedPriorityTargets' | 'undertrainedBigrams'>
	> & { fixture?: PlannerFixture };

function planDailySessions(input: TestInput) {
	const targets = input.fixture?.priorityTargets ?? [];
	const undertrainedFromFixture = input.fixture?.undertrained ?? [];
	const { fixture: _ignored, ...rest } = input;
	return planDailySessionsRaw({
		...rest,
		accuracyPriorityTargets:
			input.accuracyPriorityTargets ??
			targets.filter((t) => t.classification === 'hasty' || t.classification === 'acquisition'),
		speedPriorityTargets:
			input.speedPriorityTargets ?? targets.filter((t) => t.classification === 'fluency'),
		undertrainedBigrams: input.undertrainedBigrams ?? undertrainedFromFixture
	});
}

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

/**
 * Default priority targets land in the *accuracy* bucket (`hasty`) so the
 * baseline `fixture([...])` helper produces an accuracy drill — that's where
 * undertrained backfill, graduation filtering, and exposure edge cases live,
 * so the default matches the test surface area. Tests that need fluency
 * targets pass `'fluency'` explicitly via `priorityTargetWithClass`.
 */
function priorityTarget(
	bigram: string,
	classification: PriorityBigram['classification'] = 'hasty'
): PriorityBigram {
	return { bigram, score: 1, meanTime: 300, errorRate: 0, classification };
}

function fixture(priorityBigrams: string[], undertrained: string[] = []): PlannerFixture {
	return {
		// Wrap to keep `Array.map`'s `(value, index)` arity from binding to the
		// helper's optional `classification` arg — that'd silently assign the
		// loop index as a "classification" and skip every target in the mix.
		priorityTargets: priorityBigrams.map((b) => priorityTarget(b)),
		undertrained
	};
}

describe('planDailySessions — diagnostic triggers', () => {
	it('first-run: empty history → single diagnostic', () => {
		const plan = planDailySessions({ recentSessions: [] });
		expect(plan).toHaveLength(1);
		expect(plan[0].config.type).toBe('diagnostic');
		expect(plan[0].label).toBe('First diagnostic');
	});

	it('history exists but no diagnostic report → fallback diagnostic', () => {
		const plan = planDailySessions({
			recentSessions: recent('real-text', 'bigram-drill')
		});
		expect(plan).toHaveLength(1);
		expect(plan[0].config.type).toBe('diagnostic');
		expect(plan[0].rationale).toMatch(/no diagnostic on file/i);
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
				fixture: fixture(['th', 'he'])
			});
			if (shouldDiagnose) {
				expect(plan[0].config.type).toBe('diagnostic');
				expect(plan[0].label).toBe('Weekly diagnostic');
			} else {
				expect(plan[0].config.type).toBe('bigram-drill');
			}
		}
	);

	/**
	 * Fresh-plan prepend: when "Start fresh plan" has been clicked (planStartedAt
	 * is a recent timestamp), the latest diagnostic is "stale" from the fresh-plan
	 * perspective unless it was run after the cursor. The planner prepends a
	 * diagnostic in that case so the user refreshes their baseline before drilling.
	 */
	describe('fresh-plan diagnostic', () => {
		it('prepends a diagnostic when last one predates planStartedAt', () => {
			const plan = planDailySessions({
				recentSessions: recent('diagnostic'),
				// recent('diagnostic') builds a session at timestamp 1; planStartedAt 1000 ⇒ stale.
				fixture: fixture(['th']),
				planStartedAt: 1000
			});
			expect(plan[0].config.type).toBe('diagnostic');
			expect(plan[0].label).toBe('Fresh-plan diagnostic');
			// Rest of the day follows.
			expect(plan.length).toBeGreaterThan(1);
			expect(plan[1].config.type).toBe('bigram-drill');
		});

		it('does not prepend when last diagnostic is newer than planStartedAt', () => {
			const plan = planDailySessions({
				recentSessions: [session('diagnostic', 5000)],
				fixture: fixture(['th']),
				planStartedAt: 1000
			});
			expect(plan[0].config.type).not.toBe('diagnostic');
		});

		it('does nothing when planStartedAt is unset', () => {
			const plan = planDailySessions({
				recentSessions: recent('diagnostic'),
				fixture: fixture(['th'])
			});
			expect(plan[0].config.type).not.toBe('diagnostic');
		});
	});
});

describe('planDailySessions — default daily structure', () => {
	it('mid-cycle: accuracy-only targets produce [accuracy, real-text] × CYCLES_PER_DAY', () => {
		// All defaults are hasty → accuracy drill only. Speed slot is silently
		// skipped, so each cycle is 2 items instead of 3.
		const plan = planDailySessions({
			recentSessions: recent('real-text', 'diagnostic'),
			fixture: fixture(['th', 'he', 'in'])
		});
		expect(plan).toHaveLength(CYCLES_PER_DAY * 2);
		for (let i = 0; i < CYCLES_PER_DAY; i++) {
			expect(plan[i * 2].config.type).toBe('bigram-drill');
			expect(plan[i * 2].config.drillMode).toBe('accuracy');
			expect(plan[i * 2 + 1].config.type).toBe('real-text');
		}
		expect(plan[0].config.wordBudget).toBe(DEFAULT_BIGRAM_DRILL_WORD_BUDGET);
		expect(plan[1].config.wordBudget).toBe(DEFAULT_REAL_TEXT_WORD_BUDGET);
	});

	it('mixed classes: full cycle emits [accuracy, speed, real-text]', () => {
		// Explicit class mix — accuracy and speed buckets both non-empty.
		const plan = planDailySessions({
			recentSessions: recent('diagnostic'),
			fixture: {
				priorityTargets: [
					priorityTarget('th', 'hasty'),
					priorityTarget('in', 'hasty'),
					priorityTarget('er', 'fluency')
				],
				undertrained: []
			}
		});
		expect(plan).toHaveLength(CYCLES_PER_DAY * 3);
		// Spot-check the first cycle — all three slots present, in order.
		expect(plan[0].config.drillMode).toBe('accuracy');
		expect(plan[0].config.bigramsTargeted).toEqual(['th', 'in']);
		expect(plan[1].config.drillMode).toBe('speed');
		expect(plan[1].config.bigramsTargeted).toEqual(['er']);
		expect(plan[2].config.type).toBe('real-text');
	});

	it('fluency-only targets: cycle skips accuracy slot', () => {
		const plan = planDailySessions({
			recentSessions: recent('diagnostic'),
			fixture: {
				priorityTargets: [priorityTarget('er', 'fluency'), priorityTarget('an', 'fluency')],
				undertrained: []
			}
		});
		// CYCLES_PER_DAY × [speed, real-text] = 6.
		expect(plan).toHaveLength(CYCLES_PER_DAY * 2);
		for (let i = 0; i < CYCLES_PER_DAY; i++) {
			expect(plan[i * 2].config.drillMode).toBe('speed');
			expect(plan[i * 2 + 1].config.type).toBe('real-text');
		}
	});

	it('drill uses top priority bigrams up to the default count', () => {
		// 15 targets; default cap trims to 10.
		const targets = Array.from({ length: 15 }, (_, i) => `b${i}`);
		const plan = planDailySessions({
			recentSessions: recent('diagnostic'),
			fixture: fixture(targets)
		});
		expect(plan[0].config.bigramsTargeted).toHaveLength(DEFAULT_DRILL_TARGET_COUNT);
		expect(plan[0].config.bigramsTargeted?.[0]).toBe('b0');
	});

	it('drill target count override is honored', () => {
		const plan = planDailySessions({
			recentSessions: recent('diagnostic'),
			fixture: fixture(['a', 'b', 'c', 'd']),
			drillTargetCount: 2
		});
		expect(plan[0].config.bigramsTargeted).toEqual(['a', 'b']);
	});

	it('graduated bigrams are stripped from drill targets, order preserved', () => {
		const plan = planDailySessions({
			recentSessions: recent('diagnostic'),
			fixture: fixture(['th', 'he', 'in', 'er']),
			graduatedFromRotation: new Set(['he', 'er'])
		});
		expect(plan[0].config.bigramsTargeted).toEqual(['th', 'in']);
	});

	it('all priority targets graduated and no undertrained → skip drill, emit real-text only', () => {
		const plan = planDailySessions({
			recentSessions: recent('diagnostic'),
			fixture: fixture(['th', 'he']),
			graduatedFromRotation: new Set(['th', 'he'])
		});
		// CYCLES_PER_DAY × [real-text only]. Both drill slots skipped because
		// every target is graduated and no undertrained is available.
		expect(plan).toHaveLength(CYCLES_PER_DAY);
		expect(plan.every((p) => p.config.type === 'real-text')).toBe(true);
	});
});

describe('planDailySessions — exposure backfill from undertrained', () => {
	// The scenario that motivated this: after a short first diagnostic, almost
	// every bigram is still `unclassified` (< MIN_OCCURRENCES_FOR_CLASSIFICATION
	// samples), so `priorityTargets` is empty or near-empty. Without backfill,
	// drill would either skip entirely or target only a sliver of what the user
	// actually needs to practice. Backfilling from `corpusFit.undertrained`
	// (high-frequency corpus bigrams the user hasn't typed enough) turns the
	// drill into a useful exposure session until classification catches up.

	it('short priority list → backfilled from undertrained up to drillTargetCount', () => {
		const plan = planDailySessions({
			recentSessions: recent('diagnostic'),
			fixture: fixture(
				['th', 'he'],
				// Undertrained is already frequency-sorted by the diagnostic engine;
				// planner should preserve that order.
				['in', 'er', 'an', 'on', 'at', 're', 'en', 'or']
			),
			drillTargetCount: 5
		});
		// 2 priority + 3 exposure = 5 targets; flattened priority-first.
		expect(plan[0].config.bigramsTargeted).toEqual(['th', 'he', 'in', 'er', 'an']);
		expect(plan[0].drillMix).toEqual({
			priority: ['th', 'he'],
			exposure: ['in', 'er', 'an']
		});
	});

	it('priority already fills the cap → no exposure needed', () => {
		const plan = planDailySessions({
			recentSessions: recent('diagnostic'),
			fixture: fixture(['a', 'b', 'c'], ['x', 'y']),
			drillTargetCount: 3
		});
		expect(plan[0].drillMix).toEqual({ priority: ['a', 'b', 'c'], exposure: [] });
	});

	it('empty priority, non-empty undertrained → exposure-only drill', () => {
		// First-diagnostic scenario: nothing crossed the classification floor,
		// but the corpus gives us a ranked list of common bigrams to expose.
		const plan = planDailySessions({
			recentSessions: recent('diagnostic'),
			fixture: fixture([], ['th', 'he', 'in']),
			drillTargetCount: 3
		});
		expect(plan[0].config.type).toBe('bigram-drill');
		expect(plan[0].drillMix).toEqual({ priority: [], exposure: ['th', 'he', 'in'] });
		// Rationale should make the exposure-only nature explicit — the user
		// should know this isn't a weakness-driven drill yet.
		expect(plan[0].rationale).toMatch(/not enough data/i);
	});

	it('graduated bigrams are stripped from exposure too', () => {
		const plan = planDailySessions({
			recentSessions: recent('diagnostic'),
			fixture: fixture([], ['th', 'he', 'in']),
			graduatedFromRotation: new Set(['he']),
			drillTargetCount: 5
		});
		expect(plan[0].drillMix?.exposure).toEqual(['th', 'in']);
	});

	it('priority/exposure overlap is deduped — a bigram picked as priority is not also exposed', () => {
		// In practice `undertrained` and `priorityTargets` come from disjoint
		// populations (classified vs. not), but the two lists are built
		// independently and nothing in the engine guarantees no overlap —
		// defend against it here.
		const plan = planDailySessions({
			recentSessions: recent('diagnostic'),
			fixture: fixture(['th'], ['th', 'he']),
			drillTargetCount: 3
		});
		expect(plan[0].drillMix).toEqual({ priority: ['th'], exposure: ['he'] });
	});

	it('rationale reflects the mix (priority + exposure)', () => {
		const plan = planDailySessions({
			recentSessions: recent('diagnostic'),
			fixture: fixture(['th'], ['he', 'in']),
			drillTargetCount: 3
		});
		// Accuracy-mode rationale uses "error-prone" vocabulary — fluency mode
		// uses "accurate-but-slow". Pinning the exact phrasing would make copy
		// tweaks churn the test; just confirm the shape (count of error-prone +
		// count of new bigrams) lands in the string.
		expect(plan[0].rationale).toMatch(/1 error-prone.*2 new bigrams/);
	});

	it('empty priority AND empty undertrained → no drill, real-text only', () => {
		// The "nothing to do" fallback survives — both buckets must be empty.
		const plan = planDailySessions({
			recentSessions: recent('diagnostic'),
			fixture: fixture([], [])
		});
		expect(plan.every((p) => p.config.type === 'real-text')).toBe(true);
	});

	it('pure-priority drills expose no drillMix.exposure entries', () => {
		// Regression guard: when backfill isn't needed, the mix's exposure
		// array must remain empty (not undefined, not accidentally populated).
		const plan = planDailySessions({
			recentSessions: recent('diagnostic'),
			fixture: fixture(['th', 'he'])
		});
		expect(plan[0].drillMix).toEqual({ priority: ['th', 'he'], exposure: [] });
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
			fixture: fixture(['th'])
		});
	}

	it('returns the full plan when nothing has been completed today', () => {
		const full = dailyPlan();
		const remaining = sliceCompletedFromPlan(full, {});
		expect(remaining).toHaveLength(full.length);
		expect(remaining[0]).toBe(full[0]);
	});

	/**
	 * Accuracy-only default plan = CYCLES_PER_DAY × [accuracy-drill, real-text]
	 * → 6 items total. Completing a drill consumes the earliest accuracy slot;
	 * real-text credits do the same for their slots. Unused credit (more
	 * "done" than actual slots) is dropped, not carried over.
	 */
	it.each`
		drillsDone        | realTextDone      | expectedRemaining
		${1}              | ${0}              | ${CYCLES_PER_DAY * 2 - 1}
		${2}              | ${0}              | ${CYCLES_PER_DAY * 2 - 2}
		${2}              | ${2}              | ${CYCLES_PER_DAY * 2 - 4}
		${CYCLES_PER_DAY} | ${CYCLES_PER_DAY} | ${0}
	`(
		'$drillsDone drills + $realTextDone real-text done → $expectedRemaining remaining',
		({ drillsDone, realTextDone, expectedRemaining }) => {
			const full = dailyPlan();
			const remaining = sliceCompletedFromPlan(full, {
				'bigram-drill/accuracy': drillsDone,
				'real-text': realTextDone
			});
			expect(remaining).toHaveLength(expectedRemaining);
		}
	);

	it('preserves interleaving order of surviving items', () => {
		// 1 accuracy drill done → first survivor is the initial real-text
		// (the accuracy slot that would have been first is consumed), then
		// the remaining [accuracy, real-text, accuracy, real-text] alternation.
		const full = dailyPlan();
		const remaining = sliceCompletedFromPlan(full, { 'bigram-drill/accuracy': 1 });
		expect(remaining[0].config.type).toBe('real-text');
		expect(remaining[1].config.type).toBe('bigram-drill');
	});

	it('does not consume credits across unrelated session types', () => {
		// A diagnostic-day plan is a single diagnostic item; completing a
		// drill earlier in the day shouldn't mark it done.
		const diagPlan = planDailySessions({ recentSessions: [] });
		const remaining = sliceCompletedFromPlan(diagPlan, { 'bigram-drill/accuracy': 3 });
		expect(remaining).toEqual(diagPlan);
	});

	/**
	 * Regression: before we keyed by `PlanSlotKey`, the slicer treated all
	 * `bigram-drill` completions as interchangeable. In a mixed plan that meant
	 * a speed completion could consume the accuracy slot (or vice versa),
	 * leaving the user facing the same drill mode back-to-back. These cases
	 * pin the fix: each completion consumes the slot for its actual mode.
	 */
	describe('drill-mode accounting in mixed plans', () => {
		/**
		 * Mixed plan = [accuracy, speed, real-text] × CYCLES_PER_DAY.
		 * Uses both hasty+acquisition (→ accuracy bucket) and fluency (→ speed
		 * bucket) so both drill slots are present.
		 */
		function mixedPlan() {
			return planDailySessions({
				recentSessions: recent('diagnostic'),
				fixture: {
					priorityTargets: [pt('th', 'hasty'), pt('er', 'fluency')],
					undertrained: []
				}
			});
		}

		it('accuracy completion survives the first speed slot', () => {
			const full = mixedPlan();
			const remaining = sliceCompletedFromPlan(full, { 'bigram-drill/accuracy': 1 });
			// First accuracy consumed → speed is next, then real-text, then the second cycle.
			expect(remaining[0].config.type).toBe('bigram-drill');
			expect(remaining[0].config.drillMode).toBe('speed');
			expect(remaining[1].config.type).toBe('real-text');
		});

		it('speed completion leaves the first accuracy slot intact', () => {
			const full = mixedPlan();
			const remaining = sliceCompletedFromPlan(full, { 'bigram-drill/speed': 1 });
			// Accuracy is still first; the consumed slot is cycle 1's speed.
			expect(remaining[0].config.type).toBe('bigram-drill');
			expect(remaining[0].config.drillMode).toBe('accuracy');
			expect(remaining[1].config.type).toBe('real-text');
			// Cycle 2 retains its [accuracy, speed, real-text] triple.
			expect(remaining[2].config.drillMode).toBe('accuracy');
			expect(remaining[3].config.drillMode).toBe('speed');
		});

		it('accuracy credit does not consume a speed slot', () => {
			const full = mixedPlan();
			// 3 accuracy completions, no speed. Plan has 2 accuracy slots total —
			// the extra credit must be dropped, not leak into speed.
			const remaining = sliceCompletedFromPlan(full, { 'bigram-drill/accuracy': 3 });
			// Both accuracy slots consumed; both speed slots + both real-texts remain.
			expect(remaining).toHaveLength(4);
			expect(remaining.filter((p) => p.config.drillMode === 'speed')).toHaveLength(2);
			expect(remaining.filter((p) => p.config.drillMode === 'accuracy')).toHaveLength(0);
		});
	});
});

/**
 * Build a `PriorityBigram` with an explicit class. The default helper up top
 * hard-codes `fluency`; these tests need a mix of classes to exercise the
 * accuracy-vs-speed split.
 */
function pt(bigram: string, classification: PriorityBigram['classification']): PriorityBigram {
	return { bigram, score: 1, meanTime: 300, errorRate: 0, classification };
}

describe('selectAccuracyDrillMix', () => {
	it('includes hasty and acquisition targets, excludes fluency', () => {
		const mix = selectAccuracyDrillMix(
			[pt('th', 'hasty'), pt('er', 'fluency'), pt('in', 'acquisition')],
			[],
			undefined,
			10
		);
		expect(mix.priority).toEqual(['th', 'in']);
		expect(mix.exposure).toEqual([]);
	});

	it('backfills with undertrained when priority is short of count', () => {
		const mix = selectAccuracyDrillMix([pt('th', 'hasty')], ['ab', 'cd'], undefined, 3);
		expect(mix.priority).toEqual(['th']);
		expect(mix.exposure).toEqual(['ab', 'cd']);
	});

	it('does not backfill when priority fills the count', () => {
		const mix = selectAccuracyDrillMix(
			[pt('th', 'hasty'), pt('in', 'acquisition')],
			['ab'],
			undefined,
			2
		);
		expect(mix.priority).toEqual(['th', 'in']);
		expect(mix.exposure).toEqual([]);
	});

	it('respects graduated filter on both priority and exposure', () => {
		const graduated = new Set(['th', 'ab']);
		const mix = selectAccuracyDrillMix(
			[pt('th', 'hasty'), pt('in', 'acquisition')],
			['ab', 'cd'],
			graduated,
			4
		);
		expect(mix.priority).toEqual(['in']);
		expect(mix.exposure).toEqual(['cd']);
	});

	it('dedupes exposure against priority', () => {
		// Same bigram appearing in both lists — shouldn't double-count.
		const mix = selectAccuracyDrillMix([pt('th', 'hasty')], ['th', 'ab'], undefined, 3);
		expect(mix.priority).toEqual(['th']);
		expect(mix.exposure).toEqual(['ab']);
	});
});

describe('planDailySessions — class-scoped priority targets', () => {
	// Every case needs a diagnostic in recent history so the planner doesn't
	// trigger the "no diagnostic on file" short-circuit and emit a diagnostic
	// instead of drills.
	const recentWithDiag = recent('diagnostic');

	it('uses speedPriorityTargets for the speed drill instead of the cross-class report list', () => {
		// Report has only hasty bigrams (the cross-class list that would starve
		// a fluency-only speed drill). speedPriorityTargets supplies fluency
		// bigrams that the planner should route into the speed slot.
		const plan = planDailySessions({
			recentSessions: recentWithDiag,
			fixture: fixture(['th', 'he', 'in']),
			speedPriorityTargets: [priorityTarget('er', 'fluency'), priorityTarget('an', 'fluency')]
		});
		const speedDrill = plan.find(
			(p) => p.config.type === 'bigram-drill' && p.config.drillMode === 'speed'
		);
		expect(speedDrill?.drillMix?.priority).toEqual(['er', 'an']);
	});

	it('uses accuracyPriorityTargets for the accuracy drill when provided', () => {
		const plan = planDailySessions({
			recentSessions: recentWithDiag,
			fixture: fixture(['er']), // fluency-only report would starve accuracy
			accuracyPriorityTargets: [priorityTarget('th', 'hasty'), priorityTarget('in', 'acquisition')]
		});
		const accuracyDrill = plan.find(
			(p) => p.config.type === 'bigram-drill' && p.config.drillMode === 'accuracy'
		);
		expect(accuracyDrill?.drillMix?.priority).toEqual(['th', 'in']);
	});

	it('falls back to report.priorityTargets when class-scoped lists are absent', () => {
		// Backward-compat: planner signature is additive — no regressions for
		// callers that still pass only the report.
		const plan = planDailySessions({
			recentSessions: recentWithDiag,
			fixture: fixture(['th'])
		});
		const accuracyDrill = plan.find(
			(p) => p.config.type === 'bigram-drill' && p.config.drillMode === 'accuracy'
		);
		expect(accuracyDrill?.drillMix?.priority).toEqual(['th']);
	});
});

describe('selectSpeedDrillMix', () => {
	it('includes fluency only, excludes hasty and acquisition', () => {
		const mix = selectSpeedDrillMix(
			[pt('th', 'hasty'), pt('er', 'fluency'), pt('in', 'acquisition')],
			undefined,
			10
		);
		expect(mix.priority).toEqual(['er']);
	});

	it('returns empty exposure regardless of input', () => {
		// Speed mode has no exposure bucket — undertrained bigrams go to accuracy.
		const mix = selectSpeedDrillMix([pt('er', 'fluency')], undefined, 10);
		expect(mix.exposure).toEqual([]);
	});

	it('respects graduated filter', () => {
		const graduated = new Set(['er']);
		const mix = selectSpeedDrillMix([pt('er', 'fluency'), pt('an', 'fluency')], graduated, 10);
		expect(mix.priority).toEqual(['an']);
	});

	it('caps priority at count', () => {
		const mix = selectSpeedDrillMix(
			[pt('er', 'fluency'), pt('an', 'fluency'), pt('ou', 'fluency')],
			undefined,
			2
		);
		expect(mix.priority).toEqual(['er', 'an']);
	});
});
