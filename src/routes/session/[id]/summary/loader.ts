import { getSession, getRecentSessions } from '$lib/support/storage';
import { computePlan } from '$lib/plan';
import type { PlannedSession } from '$lib/plan';
import { getProfile } from '$lib/settings';
import { isBuiltinCorpusId, loadBuiltinCorpus, type FrequencyTable } from '$lib/corpus';
import type { SessionSummary } from '$lib/support/core';

const FALLBACK_CORPUS_ID = 'en';

export type SummaryViewModel =
	| { status: 'missing' }
	| {
			status: 'ready';
			session: SessionSummary;
			statsSessions: readonly SessionSummary[];
			corpusFrequencies: FrequencyTable | undefined;
			next: PlannedSession | undefined;
	  };

export async function loadSummaryContext(id: string): Promise<SummaryViewModel> {
	const [session, statsSessions, profile] = await Promise.all([
		getSession(id),
		getRecentSessions(),
		getProfile()
	]);
	if (!session) return { status: 'missing' };

	const { plan } = await computePlan({ statsSessions });

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
		statsSessions,
		corpusFrequencies,
		next: plan[0]
	};
}
