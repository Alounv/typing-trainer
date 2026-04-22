import { resolve } from '$app/paths';
import { stashPlannedSession } from './planned';
import { setPlanStartedAt } from './plan-window';
import type { PlannedSession } from './types';

/**
 * Hand-off: stash the planned config for the target route to pick up, then full-page
 * navigate. Full-page (not SvelteKit `goto`) so each session route remounts cleanly
 * with its freshly-consumed plan — avoids state leaking across routes.
 */
export function startPlannedSession(planned: PlannedSession): void {
	stashPlannedSession(planned);
	window.location.href = routeForPlannedSession(planned);
}

/**
 * Snapshot `now` as the new plan-window cursor and reload the dashboard. Earlier
 * completions fall outside the cutoff and the planner emits a fresh plan.
 */
export function startFreshPlan(): void {
	setPlanStartedAt(Date.now());
	window.location.href = resolve('/');
}

function routeForPlannedSession(planned: PlannedSession): string {
	const { type } = planned.config;
	switch (type) {
		case 'diagnostic':
			return resolve('/session/diagnostic');
		case 'bigram-drill':
			// Legacy plans (no drillMode) default to accuracy — matches the direct-nav default.
			return planned.config.drillMode === 'speed'
				? resolve('/session/speed-drill')
				: resolve('/session/accuracy-drill');
		case 'real-text':
			return resolve('/session/real-text');
	}
}
