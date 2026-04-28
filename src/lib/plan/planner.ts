import {
	DEFAULT_BIGRAM_DRILL_WORD_BUDGET,
	DEFAULT_REAL_TEXT_WORD_BUDGET,
	DEFAULT_DIAGNOSTIC_WORD_BUDGET
} from '../support/core';
import type {
	DrillMode,
	PriorityBigram,
	SessionConfig,
	SessionSummary,
	UserSettings
} from '../support/core';
import { planSlotKey } from './types';
import type { PlanSlotKey, SchedulerInput, PlannedSession } from './types';

function resolveWordBudgets(settings?: UserSettings) {
	return {
		bigramDrill: settings?.wordBudgets?.bigramDrill ?? DEFAULT_BIGRAM_DRILL_WORD_BUDGET,
		realText: settings?.wordBudgets?.realText ?? DEFAULT_REAL_TEXT_WORD_BUDGET,
		diagnostic: settings?.wordBudgets?.diagnostic ?? DEFAULT_DIAGNOSTIC_WORD_BUDGET
	};
}

export const DEFAULT_DRILL_TARGET_COUNT = 10;

/**
 * Each cycle is accuracy × 2 → speed × 2 → real-text. Drill slots with
 * empty target pools are skipped; real-text always runs as the transfer test.
 */
const CYCLES_PER_DAY = 2;
const DRILLS_PER_MODE_PER_CYCLE = 2;

export function planDailySessions(input: SchedulerInput): PlannedSession[] {
	const {
		statsSessions,
		graduatedFromRotation,
		accuracyPriorityTargets,
		speedPriorityTargets,
		undertrainedBigrams,
		drillTargetCount = DEFAULT_DRILL_TARGET_COUNT,
		userSettings,
		planStartedAt
	} = input;

	const budgets = resolveWordBudgets(userSettings);

	if (statsSessions.length === 0) {
		return [
			diagnosticPlan(
				budgets.diagnostic,
				'First diagnostic',
				'Establishes your baseline WPM and highlights which bigrams to drill.'
			)
		];
	}

	// Missing diagnostic (manual delete / schema migration) — fail safe.
	const latestDiagnostic = findLatestDiagnostic(statsSessions);
	if (!latestDiagnostic) {
		return [
			diagnosticPlan(
				budgets.diagnostic,
				'Diagnostic',
				'No diagnostic on file — running one now so drills have current targets.'
			)
		];
	}

	if (latestDiagnostic.timestamp < startOfCalendarDayMs()) {
		return [
			diagnosticPlan(
				budgets.diagnostic,
				'Daily diagnostic',
				'First session of the day — refreshes your baseline and drill targets.'
			)
		];
	}

	const accuracyMix = selectAccuracyDrillMix(
		accuracyPriorityTargets,
		undertrainedBigrams,
		graduatedFromRotation,
		drillTargetCount
	);
	const speedMix = selectSpeedDrillMix(
		speedPriorityTargets,
		graduatedFromRotation,
		drillTargetCount
	);

	const accuracyHasTargets = accuracyMix.priority.length > 0 || accuracyMix.exposure.length > 0;
	const speedHasTargets = speedMix.priority.length > 0;

	const drillPlanItems: PlannedSession[] =
		!accuracyHasTargets && !speedHasTargets
			? Array.from({ length: CYCLES_PER_DAY }, () =>
					realtextPlan(budgets.realText, 'no-targets-left')
				)
			: buildDrillCycles(accuracyMix, speedMix, budgets, accuracyHasTargets, speedHasTargets);

	// "Start fresh plan" bumps planStartedAt; diagnostics older than that are
	// stale relative to the new window, so prepend a refresher.
	if (planStartedAt && latestDiagnostic.timestamp < planStartedAt) {
		return [
			diagnosticPlan(
				budgets.diagnostic,
				'Fresh-plan diagnostic',
				'Start of a fresh plan — refresh the baseline so the drills below use current targets.'
			),
			...drillPlanItems
		];
	}

	return drillPlanItems;
}

function findLatestDiagnostic(recent: readonly SessionSummary[]): SessionSummary | undefined {
	return recent.find((s) => s.type === 'diagnostic');
}

function buildDrillCycles(
	accuracyMix: { priority: string[]; exposure: string[] },
	speedMix: { priority: string[]; exposure: string[] },
	budgets: { bigramDrill: number; realText: number; diagnostic: number },
	accuracyHasTargets: boolean,
	speedHasTargets: boolean
): PlannedSession[] {
	const plan: PlannedSession[] = [];
	for (let i = 0; i < CYCLES_PER_DAY; i++) {
		if (accuracyHasTargets) {
			for (let j = 0; j < DRILLS_PER_MODE_PER_CYCLE; j++) {
				plan.push(drillPlan(accuracyMix, 'accuracy', budgets.bigramDrill));
			}
		}
		if (speedHasTargets) {
			for (let j = 0; j < DRILLS_PER_MODE_PER_CYCLE; j++) {
				plan.push(drillPlan(speedMix, 'speed', budgets.bigramDrill));
			}
		}
		plan.push(realtextPlan(budgets.realText));
	}
	return plan;
}

export function startOfCalendarDayMs(): number {
	const d = new Date();
	d.setHours(0, 0, 0, 0);
	return d.getTime();
}

/**
 * Priority = `hasty` + `acquisition` + `unclassified` (all fail on accuracy or
 * lack the data to prove they don't); exposure = undertrained backfill
 * (corpus bigrams the user simply hasn't seen yet).
 *
 * Exported so the drill route's direct-nav fallback uses the same selection.
 */
export function selectAccuracyDrillMix(
	priorityTargets: readonly PriorityBigram[],
	undertrainedBigrams: readonly string[],
	graduated: ReadonlySet<string> | undefined,
	count: number
): { priority: string[]; exposure: string[] } {
	const filter = graduated ?? new Set<string>();

	const priority: string[] = [];
	for (const t of priorityTargets) {
		if (
			t.classification !== 'hasty' &&
			t.classification !== 'acquisition' &&
			t.classification !== 'unclassified'
		)
			continue;
		if (filter.has(t.bigram)) continue;
		priority.push(t.bigram);
		if (priority.length >= count) break;
	}

	const remaining = count - priority.length;
	const exposure: string[] = [];
	if (remaining > 0) {
		const seen = new Set(priority);
		for (const b of undertrainedBigrams) {
			if (filter.has(b)) continue;
			if (seen.has(b)) continue;
			exposure.push(b);
			if (exposure.length >= remaining) break;
		}
	}

	return { priority, exposure };
}

/**
 * Priority = `fluency` only (accurate but slow). No exposure: undertrained
 * bigrams go to accuracy mode where "don't push speed yet" applies. Empty
 * exposure kept in the return shape for symmetry with {@link selectAccuracyDrillMix}.
 */
export function selectSpeedDrillMix(
	priorityTargets: readonly PriorityBigram[],
	graduated: ReadonlySet<string> | undefined,
	count: number
): { priority: string[]; exposure: string[] } {
	const filter = graduated ?? new Set<string>();

	const priority: string[] = [];
	for (const t of priorityTargets) {
		if (t.classification !== 'fluency') continue;
		if (filter.has(t.bigram)) continue;
		priority.push(t.bigram);
		if (priority.length >= count) break;
	}

	return { priority, exposure: [] };
}

function diagnosticPlan(wordBudget: number, label: string, rationale: string): PlannedSession {
	return {
		config: { type: 'diagnostic', wordBudget },
		label,
		rationale
	};
}

function drillPlan(
	mix: { priority: string[]; exposure: string[] },
	mode: DrillMode,
	wordBudget: number
): PlannedSession {
	// Priority first so `bigramsTargeted` order matches importance.
	const targets = [...mix.priority, ...mix.exposure];
	const config: SessionConfig = {
		type: 'bigram-drill',
		wordBudget,
		bigramsTargeted: targets,
		drillMode: mode
	};
	return {
		config,
		label: mode === 'speed' ? 'Speed drill' : 'Accuracy drill',
		rationale: buildDrillRationale(mix, mode),
		drillMix: mix
	};
}

function buildDrillRationale(
	mix: { priority: string[]; exposure: string[] },
	mode: DrillMode
): string {
	const p = mix.priority.length;
	const e = mix.exposure.length;
	if (mode === 'speed') {
		return `Push speed on your ${p} accurate-but-slow ${p === 1 ? 'bigram' : 'bigrams'}.`;
	}
	if (p > 0 && e === 0) return `Slow-down practice on your ${p} error-prone bigrams.`;
	if (p === 0 && e > 0) {
		return `Building exposure on ${e} common bigrams — not enough data yet to pinpoint weaknesses.`;
	}
	return `${p} error-prone + ${e} new ${e === 1 ? 'bigram' : 'bigrams'} to build exposure.`;
}

/**
 * Drop completed-today items by `PlanSlotKey` so an accuracy completion
 * consumes only an accuracy slot. Preserves interleaving order.
 */
export function sliceCompletedFromPlan(
	plan: readonly PlannedSession[],
	completedToday: Readonly<Partial<Record<PlanSlotKey, number>>>
): PlannedSession[] {
	const remaining: Partial<Record<PlanSlotKey, number>> = { ...completedToday };
	const out: PlannedSession[] = [];
	for (const item of plan) {
		const key = planSlotKey(item.config);
		const left = remaining[key] ?? 0;
		if (left > 0) {
			remaining[key] = left - 1;
			continue;
		}
		out.push(item);
	}
	return out;
}

function realtextPlan(wordBudget: number, hint?: 'no-targets-left'): PlannedSession {
	const config: SessionConfig = {
		type: 'real-text',
		wordBudget
	};
	return {
		config,
		label: 'Real text',
		rationale:
			hint === 'no-targets-left'
				? 'No drill targets remain — keeping fluency sharp with paced prose.'
				: 'Transfer drill gains into everyday typing.'
	};
}
