import { getRecentSessions } from '$lib/support/storage';
import { getProfile } from '$lib/settings';
import { hydrateSessions } from '$lib/skill';
import { loadBigramFrequencies, type FrequencyTable } from '$lib/corpus';
import type { SessionSummary } from '$lib/support/core';

interface AnalyticsInputs {
	sessions: SessionSummary[];
	/** `undefined` when the corpus chunk failed to load — consumers treat it as "no frequency weighting". */
	corpusFrequencies: FrequencyTable | undefined;
}

export async function loadAnalyticsInputs(): Promise<AnalyticsInputs> {
	// No cap: cumulative healthy-bigram-over-time needs full history to be accurate
	// for early dots (otherwise the rolling-window classifier sees a truncated past).
	const [sessionRows, profile] = await Promise.all([
		getRecentSessions(Number.POSITIVE_INFINITY),
		getProfile()
	]);

	return {
		sessions: hydrateSessions(sessionRows),
		corpusFrequencies: await loadBigramFrequencies(profile?.language ?? 'en')
	};
}
