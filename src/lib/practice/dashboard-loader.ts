// Dashboard route hand-off actions, plus a compatibility alias for the plan
// compute pipeline. The heavy lifting lives in `./plan`; this module owns the
// "Start → navigate into a session route" side-effect so route components
// never touch `sessionStorage` or `window.location` directly.
import { resolve } from '$app/paths';
import { computePlan, type PlanContext } from './plan';
import { stashPlannedSession } from './planned';
import { setPlanStartedAt } from './plan-window';
import type { PlannedSession } from './types';

/**
 * Back-compat alias — the dashboard route was the first caller, so the
 * "plan context" type still carries its original name externally.
 */
export type DashboardData = PlanContext;

/** Back-compat alias for `computePlan`. Kept so the dashboard route reads naturally. */
export const loadDashboardData = computePlan;

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
