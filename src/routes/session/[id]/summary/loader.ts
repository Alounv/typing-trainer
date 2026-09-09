import { getSession, getRecentSessions } from '$lib/support/storage';
import { getProfile } from '$lib/settings';
import { hydrateSession, hydrateSessions } from '$lib/skill';
import { loadBigramFrequencies, type FrequencyTable } from '$lib/corpus';
import type { SessionSummary } from '$lib/support/core';

interface SummaryContext {
	session: SessionSummary;
	statsSessions: readonly SessionSummary[];
	corpusFrequencies: FrequencyTable | undefined;
}

/** `null` when there is no row for `id` — a cleared database, or a stale link. */
export async function loadSummaryContext(id: string): Promise<SummaryContext | null> {
	const [row, statsRows, profile] = await Promise.all([
		getSession(id),
		getRecentSessions(),
		getProfile()
	]);
	if (!row) return null;

	return {
		session: hydrateSession(row),
		statsSessions: hydrateSessions(statsRows),
		corpusFrequencies: await loadBigramFrequencies(profile?.language ?? 'en')
	};
}
