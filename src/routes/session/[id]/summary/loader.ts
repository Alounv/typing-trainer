import { getSession, getRecentSessions } from '$lib/support/storage';
import { computePlan } from '$lib/plan';
import type { PlannedSession } from '$lib/plan';
import { getProfile } from '$lib/settings';
import { isBuiltinCorpusId, loadBuiltinCorpus, type FrequencyTable } from '$lib/corpus';
import { RECENT_WINDOW } from '$lib/support/core';
import type { SessionSummary } from '$lib/support/core';

/**
 * Wider window than the planner's `RECENT_WINDOW` so the drilled-bigrams table sees enough
 * history to fill the 50-occurrence stats window per bigram (matches Analytics).
 */
const STATS_SESSION_CAP = 500;
const FALLBACK_CORPUS_ID = 'en';

export type SummaryViewModel =
	| { status: 'missing' }
	| {
			status: 'ready';
			session: SessionSummary;
			recentSessions: readonly SessionSummary[];
			statsSessions: readonly SessionSummary[];
			corpusFrequencies: FrequencyTable | undefined;
			next: PlannedSession | undefined;
	  };

export async function loadSummaryContext(id: string): Promise<SummaryViewModel> {
	const [session, statsSessions, profile] = await Promise.all([
		getSession(id),
		getRecentSessions(STATS_SESSION_CAP),
		getProfile()
	]);
	if (!session) return { status: 'missing' };

	const recentSessions = statsSessions.slice(0, RECENT_WINDOW);
	const { plan } = await computePlan({ recentSessions });

	let corpusFrequencies: FrequencyTable | undefined;
	try {
		const pickedId = profile?.corpusIds?.[0];
		const corpusId = pickedId && isBuiltinCorpusId(pickedId) ? pickedId : FALLBACK_CORPUS_ID;
		const corpus = await loadBuiltinCorpus(corpusId);
		corpusFrequencies = corpus.bigramFrequencies;
	} catch {
		corpusFrequencies = undefined;
	}

	return {
		status: 'ready',
		session,
		recentSessions,
		statsSessions,
		corpusFrequencies,
		next: plan[0]
	};
}
