/**
 * Summary-page loader — owns the storage reads the `[id]/summary` route
 * needs. Pure composition over `storage/service`; the route stays UI.
 *
 * We return the raw `recentSessions` alongside the target session because
 * the summary page feeds that same array to several pure downstream
 * computations (delta, graduation detection, milestone detection, and a
 * re-planning call through `loadDashboardData`). Fetching it once and
 * sharing avoids four round-trips against IndexedDB.
 */
import { getSession, getRecentSessions } from '../storage/service';
import type { SessionSummary } from './types';

/** Matches the dashboard's recent-session window; the planner only peeks a few. */
const RECENT_WINDOW = 20;

export interface SummaryContext {
	/** `undefined` when the id doesn't match a stored session (stale link / cleared DB). */
	session: SessionSummary | undefined;
	recentSessions: readonly SessionSummary[];
}

export async function loadSummaryContext(id: string): Promise<SummaryContext> {
	const [session, recentSessions] = await Promise.all([
		getSession(id),
		getRecentSessions(RECENT_WINDOW)
	]);
	return { session, recentSessions };
}
