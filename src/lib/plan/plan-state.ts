/** sessionStorage-backed plan-window cursor + dashboard→route hand-off + nav actions. */
import { resolve } from '$app/paths';
import type { PlannedSession } from './types';

// Storage keys preserved verbatim so stashes from earlier builds still round-trip.
const PLAN_START_KEY = 'scheduler.planStartedAt';
const PENDING_PLAN_KEY = 'scheduler.pendingPlannedSession';

/** `0` = no cutoff. Cursors from a prior calendar day are dropped on read. */
export function readPlanStartedAt(): number {
	if (typeof sessionStorage === 'undefined') return 0;
	const raw = sessionStorage.getItem(PLAN_START_KEY);
	if (raw === null) return 0;
	const ts = Number(raw);
	if (!Number.isFinite(ts) || ts <= 0) {
		sessionStorage.removeItem(PLAN_START_KEY);
		return 0;
	}
	if (new Date(ts).toDateString() !== new Date().toDateString()) {
		sessionStorage.removeItem(PLAN_START_KEY);
		return 0;
	}
	return ts;
}

/** Read-and-clear. `expectedType` mismatch returns `undefined` but still clears. */
export function consumePlannedSession(
	expectedType?: PlannedSession['config']['type']
): PlannedSession | undefined {
	if (typeof sessionStorage === 'undefined') return undefined;
	const raw = sessionStorage.getItem(PENDING_PLAN_KEY);
	if (raw === null) return undefined;

	// Remove before parsing so a malformed stash doesn't pin across reloads.
	sessionStorage.removeItem(PENDING_PLAN_KEY);

	try {
		const parsed = JSON.parse(raw) as PlannedSession;
		if (expectedType && parsed.config.type !== expectedType) return undefined;
		return parsed;
	} catch {
		return undefined;
	}
}

// Full-page nav (not goto) so each session route remounts with its freshly-consumed plan.
export function startPlannedSession(planned: PlannedSession): void {
	if (typeof sessionStorage !== 'undefined') {
		try {
			sessionStorage.setItem(PENDING_PLAN_KEY, JSON.stringify(planned));
		} catch {
			// Private mode / quota — fall back to unhinted nav.
		}
	}
	window.location.href = routeForPlannedSession(planned);
}

export function startFreshPlan(): void {
	if (typeof sessionStorage !== 'undefined') {
		try {
			sessionStorage.setItem(PLAN_START_KEY, String(Date.now()));
		} catch {
			// Private mode / quota — silently no-op.
		}
	}
	window.location.href = resolve('/');
}

function routeForPlannedSession(planned: PlannedSession): string {
	const { type } = planned.config;
	switch (type) {
		case 'diagnostic':
			return resolve('/session/diagnostic');
		case 'bigram-drill':
			// Legacy plans without drillMode default to accuracy.
			return planned.config.drillMode === 'speed'
				? resolve('/session/speed-drill')
				: resolve('/session/accuracy-drill');
		case 'real-text':
			return resolve('/session/real-text');
	}
}
