/**
 * Summary-page loader — the single domain boundary the `[id]/summary` route
 * sees. Bundles the storage read, per-session delta, celebration detection,
 * WPM milestone check, and the "what's next" planning call into one
 * view-model so the route stays UI-only.
 *
 * Historically the route reached past this loader into `session/delta`,
 * `progress/celebrations`, and `practice/dashboard-loader` directly; each
 * relied on the same `recentSessions` window. Composing them here keeps
 * IndexedDB reads to one pass and stops the route from knowing about
 * downstream domain modules at all.
 */
import { getSession, getRecentSessions } from '../storage';
import { computeSessionDelta, type SessionDelta } from './delta';
import {
	detectGraduations,
	detectMilestone,
	type GraduationEvent,
	type MilestoneEvent
} from '../progress';
import { loadDashboardData, type PlannedSession } from '../practice';
import type { SessionSummary, SessionType } from '../core';

/** Matches the dashboard's recent-session window; the planner only peeks a few. */
const RECENT_WINDOW = 20;

export type SummaryViewModel =
	| { status: 'missing' }
	| {
			status: 'ready';
			session: SessionSummary;
			delta: SessionDelta;
			/** Bigram-level threshold crossings worth celebrating. Empty = nothing graduated. */
			graduations: GraduationEvent[];
			/** WPM milestone crossed this session on the smoothed series, or `null`. */
			milestone: MilestoneEvent | null;
			/** First item in today's remaining plan — the "Next session" CTA target. */
			next: PlannedSession | undefined;
			/** Snapshot for `activateBonusRound` when the user starts another round. */
			completedToday: Partial<Record<SessionType, number>>;
	  };

export async function loadSummaryContext(id: string): Promise<SummaryViewModel> {
	// Fetch session + recent window in parallel. `recentSessions` feeds every
	// downstream computation so we share it rather than re-reading per consumer.
	const [session, recentSessions] = await Promise.all([
		getSession(id),
		getRecentSessions(RECENT_WINDOW)
	]);
	if (!session) return { status: 'missing' };

	// Delta baseline is built over prior sessions; `computeSessionDelta` filters
	// `session` out of `recentSessions` internally, so pass the full window.
	const delta = computeSessionDelta(session, recentSessions);

	// Pair up against the most recent prior session that actually carried
	// bigram data — mirrors the rule inside `computeSessionDelta` so the
	// summary sentence and the itemised list agree on the comparison anchor.
	const prevWithBigrams =
		recentSessions
			.filter((s) => s.id !== session.id && s.bigramAggregates.length > 0)
			.sort((a, b) => b.timestamp - a.timestamp)[0] ?? null;
	const graduations = detectGraduations(
		prevWithBigrams ? prevWithBigrams.bigramAggregates : null,
		session.bigramAggregates
	);
	// `detectMilestone` also filters `session` out internally, so the full
	// window is the right input — not a pre-sliced "prior" array.
	const milestone = detectMilestone(session, recentSessions);

	// Reuse the same `recentSessions` fetch for the planner so the summary
	// page and the dashboard agree on the "what's next" answer without a
	// second IndexedDB round-trip.
	const dashboard = await loadDashboardData({ recentSessions });

	return {
		status: 'ready',
		session,
		delta,
		graduations,
		milestone,
		next: dashboard.plan[0],
		completedToday: dashboard.completedToday
	};
}
