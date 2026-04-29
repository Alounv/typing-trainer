/**
 * Plan computation pipeline — the pure "what should the user do next?"
 * resolver. Consumed by `dashboard-loader` (renders it) and `summary-loader`
 * (reuses it to pick the "Next session" CTA), so neither route-level loader
 * needs to know about the other.
 */
import type { SessionSummary, UserSettings } from '../support/core';
import { getProfile } from '../settings';
import { getBigramHistory, getRecentSessions } from '../support/storage';
import { buildLivePriorityTargets, buildLiveUndertrained } from '../skill';
import { loadBuiltinCorpus } from '../corpus';
import type { FrequencyTable } from '../corpus';
import { findGraduatedBigrams } from './graduation-filter';
import { planDailySessions, sliceCompletedFromPlan, startOfCalendarDayMs } from './planner';
import { readPlanStartedAt } from './plan-state';
import { planSlotKey } from './types';
import type { PlanSlotKey, PlannedSession } from './types';

export interface PlanContext {
	/** Plan with completed-today items stripped. Empty = done for today. */
	plan: PlannedSession[];
	/** Full plan before slicing — debug-panel only. */
	fullPlan: PlannedSession[];
	/** Named boolean so UI branches on intent, not array-length arithmetic. */
	allDoneForToday: boolean;
	/** Sessions completed since the effective plan-window cutoff. */
	completedToday: Partial<Record<PlanSlotKey, number>>;
	/**
	 * Active plan-window cursor (ms). `0` when no override is active — the
	 * cutoff is just start-of-calendar-day. Debug-panel only.
	 */
	planStartedAt: number;
	lastSession?: SessionSummary;
	graduatedFromRotation: ReadonlySet<string>;
	userSettings?: UserSettings;
}

interface ComputePlanOptions {
	/**
	 * Optional pre-fetched session set. The summary page already loads up to
	 * `STATS_SESSION_CAP` sessions for its own UI; passing them here lets the
	 * planner reuse that fetch. Absent → the planner does its own read.
	 */
	statsSessions?: readonly SessionSummary[];
}

/** Resolve everything the dashboard needs: planner + graduation filter in one await. */
export async function computePlan(opts: ComputePlanOptions = {}): Promise<PlanContext> {
	const statsSessions = opts.statsSessions ?? (await getRecentSessions());

	const userSettings = await getProfile();
	const corpusFrequencies = await loadCorpusFrequencies(userSettings);

	// Class-scoped so an error-weighted ranking can't starve the fluency-only
	// speed drill. See `SchedulerInput` comment.
	const accuracyPriorityTargets = buildLivePriorityTargets(
		statsSessions,
		corpusFrequencies,
		undefined,
		undefined,
		['hasty', 'acquisition', 'unclassified']
	);
	const speedPriorityTargets = buildLivePriorityTargets(
		statsSessions,
		corpusFrequencies,
		undefined,
		undefined,
		['fluency']
	);
	const undertrainedBigrams = buildLiveUndertrained(statsSessions, corpusFrequencies);

	const priorityBigrams = [
		...accuracyPriorityTargets.map((p) => p.bigram),
		...speedPriorityTargets.map((p) => p.bigram)
	];
	const graduatedFromRotation = await findGraduatedBigrams(priorityBigrams, getBigramHistory);

	const planStartedAt = readPlanStartedAt();
	const cutoffMs = Math.max(startOfCalendarDayMs(), planStartedAt);

	const fullPlan = planDailySessions({
		statsSessions,
		accuracyPriorityTargets,
		speedPriorityTargets,
		undertrainedBigrams,
		graduatedFromRotation,
		userSettings,
		planStartedAt
	});

	// Only the slice since `cutoffMs` counts toward today's plan. The natural
	// day-rollover and the manual "Start fresh plan" action share one mechanism.
	const completedToday = countCompletedSince(statsSessions, cutoffMs);
	const plan = sliceCompletedFromPlan(fullPlan, completedToday);

	return {
		plan,
		fullPlan,
		allDoneForToday: plan.length === 0 && fullPlan.length > 0,
		completedToday,
		planStartedAt,
		lastSession: statsSessions[0],
		graduatedFromRotation,
		userSettings
	};
}

// Per slot-key (bigram-drill splits by mode). `cutoffMs` is the effective
// plan-window start — normally start-of-day, bumped forward when the user
// clicks "Start fresh plan".
function countCompletedSince(
	sessions: readonly SessionSummary[],
	cutoffMs: number
): Partial<Record<PlanSlotKey, number>> {
	const out: Partial<Record<PlanSlotKey, number>> = {};
	for (const s of sessions) {
		if (s.timestamp < cutoffMs) continue;
		const key = planSlotKey(s);
		out[key] = (out[key] ?? 0) + 1;
	}
	return out;
}

/** Best-effort corpus load; `undefined` degrades undertrained/weighting to a no-op. */
async function loadCorpusFrequencies(
	profile: UserSettings | undefined
): Promise<FrequencyTable | undefined> {
	try {
		const corpus = await loadBuiltinCorpus(profile?.language ?? 'en');
		return corpus.bigramFrequencies;
	} catch {
		return undefined;
	}
}
