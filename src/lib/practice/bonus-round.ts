/**
 * "Start another round" override. When the user has finished today's
 * planned sessions but wants to keep going, they can activate a bonus
 * round — the dashboard then shows a fresh plan as if today's prior
 * completions didn't count. We don't lie to storage (every session is
 * still recorded honestly); we just adjust the "what's been done
 * *toward today's plan*" baseline up so the planner's output lands
 * back at zero-completed.
 *
 * Persistence: `sessionStorage`. Auto-clears when the calendar day
 * rolls over, matches the tab-scoped lifetime of everything else in
 * this app, and survives a dashboard reload (which the activation
 * trigger does to re-render with a fresh plan).
 *
 * Stacking: activating a second bonus round later the same day
 * overwrites the baseline with the current completed counts, so the
 * user gets yet another full plan. No cap — if someone wants to drill
 * all day, let them.
 */
import type { PlanSlotKey } from './types';

// v2: key shape changed from `SessionType` to `PlanSlotKey`. Stale v1 stashes
// are ignored rather than migrated (today-only persistence, tiny window).
const STORAGE_KEY = 'scheduler.bonusRound.v2';

interface BonusRoundState {
	/**
	 * Local-calendar day the activation happened on, formatted as
	 * `Date.toDateString()`. When today's value differs, the activation
	 * is considered stale and cleared.
	 */
	activatedOnDay: string;
	/**
	 * Snapshot of each slot's "completed today" count at activation.
	 * Subtracted from the live count so the planner sees zero done until
	 * the user completes more sessions past this baseline.
	 */
	completedAtActivation: Partial<Record<PlanSlotKey, number>>;
}

/**
 * Activate a bonus round. Pass in the current "completed today" map so
 * we can snapshot the baseline that subsequent completions will be
 * measured against. Silently no-ops in SSR / storage-disabled contexts.
 */
export function activateBonusRound(completedToday: Partial<Record<PlanSlotKey, number>>): void {
	if (typeof sessionStorage === 'undefined') return;
	const state: BonusRoundState = {
		activatedOnDay: new Date().toDateString(),
		completedAtActivation: { ...completedToday }
	};
	try {
		sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
	} catch {
		// Private mode / quota. Bonus round just won't apply — acceptable
		// since this is a nice-to-have override, not load-bearing.
	}
}

/**
 * Read the currently active bonus-round baseline, auto-clearing it if
 * it was activated on a day that is no longer today. Returns an empty
 * map when there is no active bonus round — callers can treat that as
 * "subtract nothing" without a special-case branch.
 */
export function readActiveBaseline(): Partial<Record<PlanSlotKey, number>> {
	if (typeof sessionStorage === 'undefined') return {};
	const raw = sessionStorage.getItem(STORAGE_KEY);
	if (raw === null) return {};

	let state: BonusRoundState;
	try {
		state = JSON.parse(raw) as BonusRoundState;
	} catch {
		// Corrupt — drop it.
		sessionStorage.removeItem(STORAGE_KEY);
		return {};
	}

	if (state.activatedOnDay !== new Date().toDateString()) {
		// Rolled past the activation day → the bonus round is yesterday's
		// concern; normal "today" plan resumes.
		sessionStorage.removeItem(STORAGE_KEY);
		return {};
	}

	return state.completedAtActivation;
}

/**
 * Apply a bonus baseline to a raw completed-today map. Subtracts the
 * baseline entry-by-entry, floored at zero. Pure; safe to call even
 * without an active bonus round (the baseline will be empty and the
 * result equals the input).
 */
export function applyBonusBaseline(
	completedToday: Partial<Record<PlanSlotKey, number>>,
	baseline: Partial<Record<PlanSlotKey, number>>
): Partial<Record<PlanSlotKey, number>> {
	const out: Partial<Record<PlanSlotKey, number>> = {};
	const keys = new Set<PlanSlotKey>([
		...(Object.keys(completedToday) as PlanSlotKey[]),
		...(Object.keys(baseline) as PlanSlotKey[])
	]);
	for (const k of keys) {
		const done = completedToday[k] ?? 0;
		const sub = baseline[k] ?? 0;
		const effective = done - sub;
		if (effective > 0) out[k] = effective;
	}
	return out;
}
