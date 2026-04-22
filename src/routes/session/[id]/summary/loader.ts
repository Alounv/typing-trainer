import { getSession, getRecentSessions } from '$lib/storage';
import { computeSessionDelta, detectGraduations, detectMilestone } from '$lib/progress';
import type { SessionDelta, GraduationEvent, MilestoneEvent } from '$lib/progress';
import { computePlan } from '$lib/plan';
import type { PlannedSession } from '$lib/plan';
import { RECENT_WINDOW } from '$lib/core';
import type { SessionSummary } from '$lib/core';

export type SummaryViewModel =
	| { status: 'missing' }
	| {
			status: 'ready';
			session: SessionSummary;
			delta: SessionDelta;
			graduations: GraduationEvent[];
			milestone: MilestoneEvent | null;
			next: PlannedSession | undefined;
	  };

export async function loadSummaryContext(id: string): Promise<SummaryViewModel> {
	const [session, recentSessions] = await Promise.all([
		getSession(id),
		getRecentSessions(RECENT_WINDOW)
	]);
	if (!session) return { status: 'missing' };

	const delta = computeSessionDelta(session, recentSessions);

	// Pick the anchor `computeSessionDelta` uses internally so its summary sentence
	// and the Graduations list agree on the comparison baseline.
	const prevWithBigrams =
		recentSessions
			.filter((s) => s.id !== session.id && s.bigramAggregates.length > 0)
			.sort((a, b) => b.timestamp - a.timestamp)[0] ?? null;
	const graduations = detectGraduations(
		prevWithBigrams ? prevWithBigrams.bigramAggregates : null,
		session.bigramAggregates
	);
	const milestone = detectMilestone(session, recentSessions);

	const { plan } = await computePlan({ recentSessions });

	return {
		status: 'ready',
		session,
		delta,
		graduations,
		milestone,
		next: plan[0]
	};
}
