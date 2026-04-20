// Dashboard data loader + hand-off actions. Bridges the pure planner to async
// storage so components only handle render, and owns the "Start → navigate
// into a session route" side-effect so route components never touch
// `sessionStorage` or `window.location` directly.
import { resolve } from '$app/paths';
import type { SessionSummary, UserSettings } from '../core';
import { getProfile } from '../settings';
import { getBigramHistory, getRecentSessions } from '../storage';
import { buildLivePriorityTargets, buildLiveUndertrained } from '../progress';
import { isBuiltinCorpusId, loadBuiltinCorpus, type FrequencyTable } from '../corpus';
import { findGraduatedBigrams } from './graduation-filter';
import { planDailySessions, sliceCompletedFromPlan } from './planner';
import { readPlanStartedAt, setPlanStartedAt } from './plan-window';
import { stashPlannedSession } from './planned';
import { planSlotKeyForSession, type PlanSlotKey, type PlannedSession } from './types';

/**
 * How many sessions to pull for cadence + diagnostic-lookup decisions. The
 * planner only peeks at ~10; 20 gives comfortable headroom without pulling a
 * full analytics load.
 */
const RECENT_WINDOW = 20;

export interface DashboardData {
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
	/**
	 * Recent-session window used for planning — exposed so the summary page
	 * (which also needs it for delta / graduation / milestone detection) can
	 * reuse the same fetch instead of doing a second one.
	 */
	recentSessions: readonly SessionSummary[];
}

interface DashboardLoadOptions {
	/**
	 * Optional pre-fetched recent sessions. Passed in by the summary page so
	 * the delta + graduation + milestone computations share the fetch with
	 * the planner. Absent → the loader does its own read.
	 */
	recentSessions?: readonly SessionSummary[];
}

/** Resolve everything the dashboard needs: planner + graduation filter in one await. */
export async function loadDashboardData(opts: DashboardLoadOptions = {}): Promise<DashboardData> {
	const recentSessions = opts.recentSessions ?? (await getRecentSessions(RECENT_WINDOW));

	const userSettings = await getProfile();
	const corpusFrequencies = await loadCorpusFrequencies(userSettings);

	// Class-scoped so an error-weighted ranking can't starve the fluency-only
	// speed drill. See `SchedulerInput` comment.
	const accuracyPriorityTargets = buildLivePriorityTargets(
		recentSessions,
		corpusFrequencies,
		undefined,
		undefined,
		['hasty', 'acquisition']
	);
	const speedPriorityTargets = buildLivePriorityTargets(
		recentSessions,
		corpusFrequencies,
		undefined,
		undefined,
		['fluency']
	);
	const undertrainedBigrams = buildLiveUndertrained(recentSessions, corpusFrequencies);

	const priorityBigrams = [
		...accuracyPriorityTargets.map((p) => p.bigram),
		...speedPriorityTargets.map((p) => p.bigram)
	];
	const graduatedFromRotation = await findGraduatedBigrams(priorityBigrams, getBigramHistory);

	const planStartedAt = readPlanStartedAt();
	const cutoffMs = Math.max(startOfCalendarDayMs(), planStartedAt);

	const fullPlan = planDailySessions({
		recentSessions,
		accuracyPriorityTargets,
		speedPriorityTargets,
		undertrainedBigrams,
		graduatedFromRotation,
		userSettings,
		planStartedAt
	});

	// Only the slice since `cutoffMs` counts toward today's plan. The natural
	// day-rollover and the manual "Start fresh plan" action share one mechanism.
	const completedToday = countCompletedSince(recentSessions, cutoffMs);
	const plan = sliceCompletedFromPlan(fullPlan, completedToday);

	return {
		plan,
		fullPlan,
		allDoneForToday: plan.length === 0 && fullPlan.length > 0,
		completedToday,
		planStartedAt,
		lastSession: recentSessions[0],
		graduatedFromRotation,
		userSettings,
		recentSessions
	};
}

/**
 * Hand-off action: stash the planned config for the target route to pick up,
 * then navigate. Full-page navigation (not SvelteKit `goto`) matches the
 * prior behaviour where each session route remounts cleanly with its
 * freshly-consumed plan — avoids surprising state leaking across routes.
 */
export function startPlannedSession(planned: PlannedSession): void {
	stashPlannedSession(planned);
	window.location.href = routeForPlannedSession(planned);
}

/**
 * Hand-off action: snapshot `now` as the new plan-window cursor, then reload
 * the dashboard. Earlier completions fall outside the cutoff and the planner
 * emits a fresh plan (with a diagnostic prepended when the latest on file
 * predates the cutoff — see `planDailySessions`).
 */
export function startFreshPlan(): void {
	setPlanStartedAt(Date.now());
	window.location.href = resolve('/');
}

/**
 * Route path for a planned session. Drill sessions split by `drillMode`:
 * accuracy and speed are separate URLs so the treatment is obvious from
 * the address bar and the nav. A drill planned without a mode (legacy
 * plans or direct nav stashes) falls back to accuracy — matches the
 * direct-nav default elsewhere in the app.
 */
function routeForPlannedSession(planned: PlannedSession): string {
	const { type } = planned.config;
	switch (type) {
		case 'diagnostic':
			return resolve('/session/diagnostic');
		case 'bigram-drill':
			return planned.config.drillMode === 'speed'
				? resolve('/session/speed-drill')
				: resolve('/session/accuracy-drill');
		case 'real-text':
			return resolve('/session/real-text');
	}
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
		const key = planSlotKeyForSession(s);
		out[key] = (out[key] ?? 0) + 1;
	}
	return out;
}

function startOfCalendarDayMs(): number {
	const d = new Date();
	d.setHours(0, 0, 0, 0);
	return d.getTime();
}

/** English fallback when the profile is missing or points at an unsupported corpus. */
const FALLBACK_CORPUS_ID = 'en';

/** Best-effort corpus load; `undefined` degrades undertrained/weighting to a no-op. */
async function loadCorpusFrequencies(
	profile: UserSettings | undefined
): Promise<FrequencyTable | undefined> {
	try {
		const pickedId = profile?.corpusIds?.[0];
		const corpusId = pickedId && isBuiltinCorpusId(pickedId) ? pickedId : FALLBACK_CORPUS_ID;
		const corpus = await loadBuiltinCorpus(corpusId);
		return corpus.bigramFrequencies;
	} catch {
		return undefined;
	}
}

