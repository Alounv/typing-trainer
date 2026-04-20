/**
 * Dashboard → session-route hand-off via `sessionStorage`. Clicking "Start" stashes
 * the `PlannedSession`; the target route reads-and-clears on mount.
 *
 * sessionStorage over query params (long target lists, clean URLs) or Svelte stores
 * (nav wipes in-memory state). The hand-off is a hint — routes must still work on
 * direct navigation. Atomic read-and-clear so a mid-session refresh doesn't re-apply.
 */
import type { PlannedSession } from './types';

// Storage key preserved verbatim so in-flight hand-offs from earlier builds
// (rare, but possible if the user navigated mid-deploy) still round-trip.
const STORAGE_KEY = 'scheduler.pendingPlannedSession';

/** Save a planned session for the next route. No-ops in SSR. */
export function stashPlannedSession(planned: PlannedSession): void {
	if (typeof sessionStorage === 'undefined') return;
	try {
		sessionStorage.setItem(STORAGE_KEY, JSON.stringify(planned));
	} catch {
		// Storage full or blocked (private mode) — fall back to unhinted nav.
	}
}

/**
 * Read-and-clear the pending plan. Returns `undefined` when no stash, corrupt JSON,
 * or type mismatch (prevents drill-plan-on-real-text cross-route accidents).
 */
export function consumePlannedSession(
	expectedType?: PlannedSession['config']['type']
): PlannedSession | undefined {
	if (typeof sessionStorage === 'undefined') return undefined;
	const raw = sessionStorage.getItem(STORAGE_KEY);
	if (raw === null) return undefined;

	// Remove before parsing so a malformed stash doesn't pin across reloads.
	sessionStorage.removeItem(STORAGE_KEY);

	try {
		const parsed = JSON.parse(raw) as PlannedSession;
		if (expectedType && parsed.config.type !== expectedType) return undefined;
		return parsed;
	} catch {
		return undefined;
	}
}
