/**
 * Daily session planner. Pure: given recent sessions, the latest diagnostic, and
 * graduated bigrams, decides the next single session — diagnostic or N interleaved
 * drill/real-text mini-sessions. The dashboard re-plans on each completion.
 */
import type { DrillMode, PriorityBigram, SessionConfig, SessionType, UserSettings } from '../core';
import {
	DEFAULT_BIGRAM_DRILL_WORD_BUDGET,
	DEFAULT_REAL_TEXT_WORD_BUDGET,
	DEFAULT_DIAGNOSTIC_WORD_BUDGET
} from '../settings';
import type { SchedulerInput, PlannedSession, PlannedSessionReason } from './types';

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
 * Run a full diagnostic every N non-diagnostic sessions. 28 is chosen so the
 * cadence stays roughly weekly for an active user — a full day is up to 9
 * mini-sessions (3 cycles × accuracy + speed + real-text), so 28 ≈ 3 days of
 * full workouts. Kept at 28 through the cycle refactor so existing users
 * don't see a surprise diagnostic the day of the migration.
 */
export const DIAGNOSTIC_INTERVAL = 28;

/** Default "top N" priority bigrams to drill per session. */
export const DEFAULT_DRILL_TARGET_COUNT = 10;

/**
 * A daily plan emits this many treatment cycles. Each cycle is up to three
 * mini-sessions: accuracy drill → speed drill → real-text. Drill slots whose
 * target pool is empty (no fluency targets, or everything graduated) are
 * silently skipped — a cycle can therefore be as short as a single real-text.
 * Real-text always runs; it's the transfer test and shouldn't ever go away.
 */
export const CYCLES_PER_DAY = 3;

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

	// 4. Default daily = treatment cycle. Split the priority list by class so
	//    hasty/acquisition bigrams feed the accuracy-drill (no speed pressure,
	//    pacer at 0.60× baseline) and fluency bigrams feed the speed-drill
	//    (pacer at 1.17× baseline). Undertrained backfill goes to accuracy —
	//    unknown bigrams are an error risk, not a speed-ceiling problem.
	const accuracyMix = selectAccuracyDrillMix(
		latestDiagnosticReport.priorityTargets,
		latestDiagnosticReport.corpusFit.undertrained,
		graduatedFromRotation,
		drillTargetCount
	);
	const speedMix = selectSpeedDrillMix(
		latestDiagnosticReport.priorityTargets,
		graduatedFromRotation,
		drillTargetCount
	);

	const accuracyHasTargets = accuracyMix.priority.length > 0 || accuracyMix.exposure.length > 0;
	const speedHasTargets = speedMix.priority.length > 0;

	// Nothing to drill at all (everything graduated, no undertrained) →
	// real-text only, one per cycle. Matches the pre-cycle fallback: the
	// dashboard still has something to offer the user.
	if (!accuracyHasTargets && !speedHasTargets) {
		return Array.from({ length: CYCLES_PER_DAY }, () =>
			realtextPlan(budgets.realText, 'no-targets-left')
		);
	}

	// Cycle emitter: [accuracy, speed, real-text] per round, skipping drill
	// slots whose pool is empty. Real-text always runs — it's the transfer
	// test that closes each cycle and the one slot that shouldn't be skipped.
	const plan: PlannedSession[] = [];
	for (let i = 0; i < CYCLES_PER_DAY; i++) {
		if (accuracyHasTargets) plan.push(drillPlan(accuracyMix, 'accuracy', budgets.bigramDrill));
		if (speedHasTargets) plan.push(drillPlan(speedMix, 'speed', budgets.bigramDrill));
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
 * Accuracy-mode selection: priority = `hasty` + `acquisition` targets (both fail
 * on accuracy — hasty from rushing, acquisition from not yet knowing the
 * motor pattern); exposure = undertrained corpus backfill, since unmeasured
 * bigrams are also an error risk. Graduated filter applies; exposure is
 * deduped against priority.
 *
 * Exported so the drill route's direct-nav fallback can reuse the same
 * selection as the planner — otherwise the two entry points would disagree.
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
		if (t.classification !== 'hasty' && t.classification !== 'acquisition') continue;
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
 * Speed-mode selection: priority = `fluency` targets only (accurate but
 * slow — the class that benefits from pacer pressure). No exposure pool:
 * undertrained bigrams go to accuracy mode where the "don't push speed yet"
 * policy applies. Exposure kept in the return shape for symmetry with
 * {@link selectAccuracyDrillMix} / `PlannedSession.drillMix`.
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
	mode: DrillMode,
	wordBudget: number
): PlannedSession {
	// Priority first so `bigramsTargeted` stays correctly ordered for source-blind consumers.
	const targets = [...mix.priority, ...mix.exposure];
	const config: SessionConfig = {
		type: 'bigram-drill',
		wordBudget,
		bigramsTargeted: targets,
		drillMode: mode
	};
	return {
		config,
		reason: 'default-drill',
		label: mode === 'speed' ? 'Speed drill' : 'Accuracy drill',
		rationale: buildDrillRationale(mix, mode),
		drillMix: mix
	};
}

/**
 * "Why this mix" line. Accuracy mix can carry priority + exposure (undertrained
 * backfill goes here); speed mix is priority-only. Copy reflects the treatment
 * intent, not just counts — "slow them down" vs "push past the ceiling."
 */
function buildDrillRationale(
	mix: { priority: string[]; exposure: string[] },
	mode: DrillMode
): string {
	const p = mix.priority.length;
	const e = mix.exposure.length;
	if (mode === 'speed') {
		return `Push speed on your ${p} accurate-but-slow ${p === 1 ? 'bigram' : 'bigrams'}.`;
	}
	// Accuracy mode: exposure-backfill branch + mixed branch are both possible.
	if (p > 0 && e === 0) return `Slow-down practice on your ${p} error-prone bigrams.`;
	if (p === 0 && e > 0) {
		return `Building exposure on ${e} common bigrams — not enough data yet to pinpoint weaknesses.`;
	}
	return `${p} error-prone + ${e} new ${e === 1 ? 'bigram' : 'bigrams'} to build exposure.`;
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
