import { getSession, getRecentSessions } from '$lib/support/storage';
import { computePlan } from '$lib/plan';
import type { PlannedSession } from '$lib/plan';
import { getProfile } from '$lib/settings';
import { hydrateSession, hydrateSessions } from '$lib/skill';
import { loadBuiltinCorpus, type FrequencyTable } from '$lib/corpus';
import { DEFAULT_THRESHOLDS } from '$lib/support/core';
import type { ClassificationThresholds, SessionSummary } from '$lib/support/core';

export type SummaryViewModel =
	| { status: 'missing' }
	| {
			status: 'ready';
			session: SessionSummary;
			statsSessions: readonly SessionSummary[];
			corpusFrequencies: FrequencyTable | undefined;
			thresholds: ClassificationThresholds;
			next: PlannedSession | undefined;
	  };

export async function loadSummaryContext(id: string): Promise<SummaryViewModel> {
	const [row, statsRows, profile] = await Promise.all([
		getSession(id),
		getRecentSessions(),
		getProfile()
	]);
	if (!row) return { status: 'missing' };

	const thresholds = profile?.thresholds ?? DEFAULT_THRESHOLDS;
	const session = hydrateSession(row, thresholds);
	const statsSessions = hydrateSessions(statsRows, thresholds);

	const { plan } = await computePlan({ statsSessions });

	let corpusFrequencies: FrequencyTable | undefined;
	try {
		const corpus = await loadBuiltinCorpus(profile?.language ?? 'en');
		corpusFrequencies = corpus.bigramFrequencies;
	} catch {
		corpusFrequencies = undefined;
	}

	return {
		status: 'ready',
		session,
		statsSessions,
		corpusFrequencies,
		thresholds,
		next: plan[0]
	};
}
