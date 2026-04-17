/**
 * Dashboard → session-route hand-off (spec §5). When the user clicks
 * "Start" on a planned session, we stash the `PlannedSession` under a
 * fixed key in `sessionStorage`, navigate to the matching route, and
 * the route reads it back on mount to configure itself with the
 * scheduler's chosen target bigrams / duration.
 *
 * Why sessionStorage (not a query param or Svelte store):
 *   - Target bigram lists can be long; clean URLs beat `?targets=…` soup
 *   - Svelte stores are in-memory — `window.location.href` nav blows them
 *     away, so the dashboard-to-route transition would lose the stash
 *   - sessionStorage is tab-scoped, auto-cleared on close, same-origin
 *     only — exactly the right lifetime for a one-hop hand-off
 *
 * The hand-off is a *hint*, not a contract. Session routes must still
 * work when no stash is present (direct nav to `/session/drill`).
 * `consumePlannedSession` atomically reads-and-clears so a refresh
 * inside the session doesn't re-apply an old plan.
 */
import type { PlannedSession } from './types';

const STORAGE_KEY = 'scheduler.pendingPlannedSession';

/**
 * Save a planned session for the next route to pick up. Silently
 * no-ops in SSR / environments without `sessionStorage`.
 */
export function stashPlannedSession(planned: PlannedSession): void {
	if (typeof sessionStorage === 'undefined') return;
	try {
		sessionStorage.setItem(STORAGE_KEY, JSON.stringify(planned));
	} catch {
		// Storage full or blocked (private mode quirks) — fall back to
		// unhinted navigation. Session route will use its own defaults.
	}
}

/**
 * Read and remove the pending plan. Returns `undefined` when:
 *   - no stash was written (direct nav to the session route)
 *   - the stored value is corrupt (stale schema, hand-edited, etc.)
 *   - the stash was for a different session type than expected
 *
 * The `expectedType` guard prevents cross-route accidents: a plan for
 * a drill shouldn't apply to a real-text session if the user typed the
 * URL manually after a dashboard click.
 */
export function consumePlannedSession(
	expectedType?: PlannedSession['config']['type']
): PlannedSession | undefined {
	if (typeof sessionStorage === 'undefined') return undefined;
	const raw = sessionStorage.getItem(STORAGE_KEY);
	if (raw === null) return undefined;

	// Remove before parsing so a malformed stash doesn't pin itself
	// across reloads.
	sessionStorage.removeItem(STORAGE_KEY);

	try {
		const parsed = JSON.parse(raw) as PlannedSession;
		if (expectedType && parsed.config.type !== expectedType) return undefined;
		return parsed;
	} catch {
		return undefined;
	}
}
