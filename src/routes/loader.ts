import { getRecentSessions } from '$lib/support/storage';
import { assessPacing, type PacingVerdict } from '$lib/skill';
import { RECENT_WINDOW } from '$lib/support/core';

/** Sessions listed on the dashboard. Enough to see a run of days, not a log. */
const RECENT_LIMIT = 8;

interface DashboardSession {
	id: string;
	timestamp: number;
	wpm: number;
	errorRate: number;
	verdict: PacingVerdict;
}

interface DashboardData {
	/** Newest first. Empty on a first visit. */
	recent: DashboardSession[];
}

/**
 * Reads scalars only — no keystroke stream is decoded here. The dashboard shows
 * what happened and offers the one action; which passage that action produces is
 * decided by the session loader, from debt.
 */
export async function loadDashboard(): Promise<DashboardData> {
	// Extra rows beyond what's listed: the oldest listed session still needs a
	// window of earlier sessions behind it to have a pace to be judged against.
	const rows = await getRecentSessions(RECENT_LIMIT + RECENT_WINDOW);

	return {
		recent: rows.slice(0, RECENT_LIMIT).map((row) => ({
			id: row.id,
			timestamp: row.timestamp,
			wpm: row.wpm,
			errorRate: row.errorRate,
			verdict: assessPacing(row, rows).verdict
		}))
	};
}
