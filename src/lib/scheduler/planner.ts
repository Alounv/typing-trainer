/**
 * Daily session planner. Pure: given recent sessions, the latest diagnostic, and
 * graduated bigrams, decides the next single session — diagnostic or N interleaved
 * drill/real-text mini-sessions. The dashboard re-plans on each completion.
 */
import type { SessionConfig, SessionType } from '../session/types';
import type { SchedulerInput, PlannedSession, PlannedSessionReason } from './types';
import {
	DEFAULT_BIGRAM_DRILL_WORD_BUDGET,
	DEFAULT_REAL_TEXT_WORD_BUDGET,
	DEFAULT_DIAGNOSTIC_WORD_BUDGET,
	type UserSettings
} from '../models';

// Word-budget trio from user settings with factory defaults. Only the planner needs
// all three at once; session routes each need only their own type.
function resolveWordBudgets(settings?: UserSettings) {
	return {
		bigramDrill: settings?.wordBudgets?.bigramDrill ?? DEFAULT_BIGRAM_DRILL_WORD_BUDGET,
		realText: settings?.wordBudgets?.realText ?? DEFAULT_REAL_TEXT_WORD_BUDGET,
		diagnostic: settings?.wordBudgets?.diagnostic ?? DEFAULT_DIAGNOSTIC_WORD_BUDGET
	};
}

/**
 * Run a full diagnostic every N non-diagnostic sessions. 28 (not 7) because a
 * daily plan now emits 8 mini-sessions; keeping ~weekly cadence means 4× the count.
 */
export const DIAGNOSTIC_INTERVAL = 28;

/** Default "top N" priority bigrams to drill per session. */
export const DEFAULT_DRILL_TARGET_COUNT = 10;

/** 4 drill + 4 real-text sessions interleaved — a full workout with save points between. */
export const PAIRS_PER_DAY = 4;

export function planDailySessions(input: SchedulerInput): PlannedSession[] {
	const {
		recentSessions,
		latestDiagnosticReport,
		graduatedFromRotation,
		drillTargetCount = DEFAULT_DRILL_TARGET_COUNT,
		userSettings
	} = input;

	const budgets = resolveWordBudgets(userSettings);

	// 1. First-run: user has never completed a session. Need a diagnostic
	//    before we can compute baseline WPM.
	if (recentSessions.length === 0) {
		return [diagnosticPlan('first-run-diagnostic', undefined, budgets.diagnostic)];
	}

	// 2. Sessions exist but no diagnostic report — manual deletion or schema
	//    migration. Fail safe with a fresh diagnostic so drill has targets.
	if (!latestDiagnosticReport) {
		return [diagnosticPlan('missing-report-diagnostic', undefined, budgets.diagnostic)];
	}

	// 3. Cadence: every DIAGNOSTIC_INTERVAL non-diagnostic sessions, re-run
	//    so thresholds and priority targets stay current.
	const since = sessionsSinceLastDiagnostic(recentSessions);
	if (since >= DIAGNOSTIC_INTERVAL) {
		return [diagnosticPlan('cadence-diagnostic', since, budgets.diagnostic)];
	}

	// 4. Default daily = drill + real text.
	const drillMix = selectDrillTargets(
		latestDiagnosticReport.priorityTargets.map((p) => p.bigram),
		latestDiagnosticReport.corpusFit.undertrained,
		graduatedFromRotation,
		drillTargetCount
	);

	// Nothing to drill (no weaknesses, no corpus backfill) → real-text only.
	if (drillMix.priority.length === 0 && drillMix.exposure.length === 0) {
		return Array.from({ length: PAIRS_PER_DAY }, () =>
			realtextPlan(budgets.realText, 'no-targets-left')
		);
	}

	// Interleave drill + real-text; each pair is independent so the user can
	// stop after any pair and the next run re-plans.
	const plan: PlannedSession[] = [];
	for (let i = 0; i < PAIRS_PER_DAY; i++) {
		plan.push(drillPlan(drillMix, budgets.bigramDrill));
		plan.push(realtextPlan(budgets.realText));
	}
	return plan;
}

// Count of non-diagnostic sessions between now and the most recent diagnostic.
// `recentSessions` is newest-first. Returns Infinity if none found → "definitely due".
function sessionsSinceLastDiagnostic(recent: readonly { type: string }[]): number {
	for (let i = 0; i < recent.length; i++) {
		if (recent[i].type === 'diagnostic') return i;
	}
	return Number.POSITIVE_INFINITY;
}

/**
 * Priority (diagnosed weaknesses) first; when short of `count`, backfill with
 * undertrained bigrams so early sessions — when most bigrams haven't hit the
 * ≥10-occurrence classification floor — still have meaningful targets.
 * Graduated filter applies to both; exposure is deduped against priority.
 */
function selectDrillTargets(
	priorityBigrams: readonly string[],
	undertrainedBigrams: readonly string[],
	graduated: ReadonlySet<string> | undefined,
	count: number
): { priority: string[]; exposure: string[] } {
	const filter = graduated ?? new Set<string>();

	const priority: string[] = [];
	for (const b of priorityBigrams) {
		if (filter.has(b)) continue;
		priority.push(b);
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

function diagnosticPlan(
	reason: Extract<
		PlannedSessionReason,
		'first-run-diagnostic' | 'cadence-diagnostic' | 'missing-report-diagnostic'
	>,
	sessionsSince: number | undefined,
	wordBudget: number
): PlannedSession {
	const config: SessionConfig = {
		type: 'diagnostic',
		wordBudget
	};
	const labels: Record<typeof reason, string> = {
		'first-run-diagnostic': 'First diagnostic',
		'cadence-diagnostic': 'Weekly diagnostic',
		'missing-report-diagnostic': 'Diagnostic'
	};
	const rationales: Record<typeof reason, string> = {
		'first-run-diagnostic': 'Establishes your baseline WPM and highlights which bigrams to drill.',
		'cadence-diagnostic':
			sessionsSince !== undefined
				? `${sessionsSince} sessions since your last diagnostic — time to refresh targets.`
				: 'Refreshes your drill targets and baseline.',
		'missing-report-diagnostic':
			'No diagnostic on file — running one now so drills have current targets.'
	};
	return {
		config,
		reason,
		label: labels[reason],
		rationale: rationales[reason]
	};
}

function drillPlan(
	mix: { priority: string[]; exposure: string[] },
	wordBudget: number
): PlannedSession {
	// Priority first so `bigramsTargeted` stays correctly ordered for source-blind consumers.
	const targets = [...mix.priority, ...mix.exposure];
	const config: SessionConfig = {
		type: 'bigram-drill',
		wordBudget,
		bigramsTargeted: targets
	};
	return {
		config,
		reason: 'default-drill',
		label: 'Bigram drill',
		rationale: buildDrillRationale(mix),
		drillMix: mix
	};
}

/** "Why this mix" line — shape varies by which buckets are populated. */
function buildDrillRationale(mix: { priority: string[]; exposure: string[] }): string {
	const p = mix.priority.length;
	const e = mix.exposure.length;
	if (p > 0 && e === 0) return `Targeted practice on your ${p} weakest bigrams.`;
	if (p === 0 && e > 0) {
		return `Building exposure on ${e} common bigrams — not enough data yet to pinpoint weaknesses.`;
	}
	return `${p} ${p === 1 ? 'weakness' : 'weaknesses'} + ${e} new ${e === 1 ? 'bigram' : 'bigrams'} to build exposure.`;
}

/**
 * Drop completed-today items from the front of a plan, matched by session type.
 * Preserves interleaving: 2 drills + 1 real-text completed from
 * [drill, rt, drill, rt, drill, rt] leaves [drill, rt, drill, rt, drill].
 */
export function sliceCompletedFromPlan(
	plan: readonly PlannedSession[],
	completedToday: Readonly<Partial<Record<SessionType, number>>>
): PlannedSession[] {
	const remaining: Partial<Record<SessionType, number>> = { ...completedToday };
	const out: PlannedSession[] = [];
	for (const item of plan) {
		const type = item.config.type;
		const left = remaining[type] ?? 0;
		if (left > 0) {
			remaining[type] = left - 1;
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
		reason: 'default-realtext',
		label: 'Real text',
		rationale:
			hint === 'no-targets-left'
				? 'No drill targets remain — keeping fluency sharp with paced prose.'
				: 'Transfer drill gains into everyday typing.'
	};
}
