import { getSession, getRecentSessions } from '$lib/support/storage';
import { computePlan } from '$lib/plan';
import type { PlannedSession } from '$lib/plan';
import { RECENT_WINDOW } from '$lib/support/core';
import type { SessionSummary } from '$lib/support/core';

export type SummaryViewModel =
	| { status: 'missing' }
	| {
			status: 'ready';
			session: SessionSummary;
			recentSessions: readonly SessionSummary[];
			next: PlannedSession | undefined;
	  };

export async function loadSummaryContext(id: string): Promise<SummaryViewModel> {
	const [session, recentSessions] = await Promise.all([
		getSession(id),
		getRecentSessions(RECENT_WINDOW)
	]);
	if (!session) return { status: 'missing' };

	const { plan } = await computePlan({ recentSessions });

	return {
		status: 'ready',
		session,
		recentSessions,
		next: plan[0]
	};
}
