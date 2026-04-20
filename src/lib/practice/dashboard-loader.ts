// Dashboard data loader + hand-off actions. Bridges the pure planner to async
// storage so components only handle render, and owns the "Start → navigate
// into a session route" side-effect so route components never touch
// `sessionStorage` or `window.location` directly.
import { resolve } from '$app/paths';
import type { DiagnosticReport, SessionSummary, SessionType, UserSettings } from '../core';
import { getProfile } from '../settings';
import { getBigramHistory, getRecentSessions } from '../storage';
import { findGraduatedBigrams } from './graduation-filter';
import { planDailySessions, sliceCompletedFromPlan } from './planner';
import { activateBonusRound, applyBonusBaseline, readActiveBaseline } from './bonus-round';
import { stashPlannedSession } from './planned';
import type { PlannedSession } from './types';

/**
 * How many sessions to pull for cadence + diagnostic-lookup decisions. The
 * planner only peeks at ~10; 20 gives comfortable headroom without pulling a
 * full analytics load.
 */
const RECENT_WINDOW = 20;

export interface DashboardData {
	/** Plan with completed-today items stripped. Empty = done for today. */
	plan: PlannedSession[];
	/** Named boolean so UI branches on intent, not array-length arithmetic. */
	allDoneForToday: boolean;
	/** Raw completed-today counts — needed for "Start another round" bonus baseline. */
	completedToday: Partial<Record<SessionType, number>>;
	lastSession?: SessionSummary;
	latestDiagnosticReport?: DiagnosticReport;
	graduatedFromRotation: ReadonlySet<string>;
	userSettings?: UserSettings;
	/**
	 * Recent-session window used for planning — exposed so the summary page
	 * (which also needs it for delta / graduation / milestone detection) can
	 * reuse the same fetch instead of doing a second one.
	 */
	recentSessions: readonly SessionSummary[];
}

export interface DashboardLoadOptions {
	/**
	 * Optional pre-fetched recent sessions. Passed in by the summary page so
	 * the delta + graduation + milestone computations share the fetch with
	 * the planner. Absent → the loader does its own read.
	 */
	recentSessions?: readonly SessionSummary[];
}

/**
 * Resolve everything the dashboard needs: planner + graduation filter +
 * latest-diagnostic-report lookup in one await. The report is read straight
 * off the most recent diagnostic's summary — computed once at save time, not
 * replayed here.
 */
export async function loadDashboardData(opts: DashboardLoadOptions = {}): Promise<DashboardData> {
	const recentSessions = opts.recentSessions ?? (await getRecentSessions(RECENT_WINDOW));

	const latestDiagnosticReport = findLatestDiagnosticReport(recentSessions);
	const userSettings = await getProfile();

	const priorityBigrams = latestDiagnosticReport?.priorityTargets.map((p) => p.bigram) ?? [];
	const graduatedFromRotation = await findGraduatedBigrams(priorityBigrams, getBigramHistory);

	const fullPlan = planDailySessions({
		recentSessions,
		latestDiagnosticReport,
		graduatedFromRotation,
		userSettings
	});

	// Strip done-today from the planner's stateless full-day output. Bonus
	// round (if active) subtracts its baseline first → earlier completions
	// are "forgiven" and the user gets a fresh plan.
	const completedToday = countCompletedToday(recentSessions);
	const effectiveCompleted = applyBonusBaseline(completedToday, readActiveBaseline());
	const plan = sliceCompletedFromPlan(fullPlan, effectiveCompleted);

	return {
		plan,
		allDoneForToday: plan.length === 0 && fullPlan.length > 0,
		completedToday,
		lastSession: recentSessions[0],
		latestDiagnosticReport,
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
 * Hand-off action: activate a bonus round and bounce the user back to the
 * dashboard so a fresh plan renders. Takes `completedToday` rather than
 * reading it here — the caller already has the loader's snapshot, and
 * passing it in keeps this function free of storage reads.
 */
export function startBonusRound(completedToday: Partial<Record<SessionType, number>>): void {
	activateBonusRound(completedToday);
	// Full reload so `loadDashboardData` re-reads the baseline and the UI
	// state matches the fresh plan from scratch.
	window.location.href = resolve('/');
}

/**
 * Snapshot today's completions as the new baseline, so the dashboard
 * re-emits a fresh plan on next load. Called after a diagnostic saves —
 * running a diagnostic is the user-facing "restart the plan" action.
 *
 * We read the recent-session window ourselves so the single call site
 * (SessionShell's post-save hook) doesn't have to assemble a
 * `completedToday` map it never otherwise needs.
 */
export async function resetPlanForFreshDiagnostic(): Promise<void> {
	const recentSessions = await getRecentSessions(RECENT_WINDOW);
	activateBonusRound(countCompletedToday(recentSessions));
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

// Count sessions per type finished today. "Today" = local calendar day — a rolling
// 24h window would keep yesterday's late session counted against tomorrow's plan.
function countCompletedToday(
	sessions: readonly SessionSummary[]
): Partial<Record<SessionType, number>> {
	const today = new Date().toDateString();
	const out: Partial<Record<SessionType, number>> = {};
	for (const s of sessions) {
		if (new Date(s.timestamp).toDateString() !== today) continue;
		out[s.type] = (out[s.type] ?? 0) + 1;
	}
	return out;
}

// Pull the most recent diagnostic's attached report. `undefined` when no
// diagnostic exists, or when the diagnostic predates v2 (no report persisted)
// — planner treats both as "missing report" and schedules a fresh diagnostic.
function findLatestDiagnosticReport(
	recentSessions: readonly SessionSummary[]
): DiagnosticReport | undefined {
	const latestDiag = recentSessions.find((s) => s.type === 'diagnostic');
	return latestDiag?.diagnosticReport;
}
