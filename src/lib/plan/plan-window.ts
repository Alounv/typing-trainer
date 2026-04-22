/**
 * Plan-window cursor. Replaces the earlier per-slot-key "bonus round" snapshot
 * with a single timestamp: sessions at or after `planStartedAt` count toward
 * today's plan, earlier ones don't. "Start fresh plan" bumps the cursor to
 * now; calendar-day rollover is expressed by the caller taking
 * `max(startOfCalendarDay, planStartedAt)`.
 *
 * Storage: sessionStorage (tab-scoped, clears on close). A stored cursor from
 * a previous calendar day is treated as stale and dropped on read.
 */
const STORAGE_KEY = 'scheduler.planStartedAt';

/** `0` when no override is active — callers treat that as "no cutoff". */
export function readPlanStartedAt(): number {
	if (typeof sessionStorage === 'undefined') return 0;
	const raw = sessionStorage.getItem(STORAGE_KEY);
	if (raw === null) return 0;
	const ts = Number(raw);
	if (!Number.isFinite(ts) || ts <= 0) {
		sessionStorage.removeItem(STORAGE_KEY);
		return 0;
	}
	// Cursor from a prior calendar day → the natural day-rollover already
	// reset the user's plan window, so the override adds nothing.
	if (new Date(ts).toDateString() !== new Date().toDateString()) {
		sessionStorage.removeItem(STORAGE_KEY);
		return 0;
	}
	return ts;
}

/** Snapshot the current moment as the new plan-start cursor. */
export function setPlanStartedAt(ts: number): void {
	if (typeof sessionStorage === 'undefined') return;
	try {
		sessionStorage.setItem(STORAGE_KEY, String(ts));
	} catch {
		// Private mode / quota — the fresh-plan action silently no-ops.
	}
}
