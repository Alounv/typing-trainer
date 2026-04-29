import { getRecentSessions, getRecentDiagnosticSessions } from '$lib/support/storage';
import { getProfile } from '$lib/settings';
import { loadBuiltinCorpus, type FrequencyTable } from '$lib/corpus';
import type { SessionSummary, UserSettings } from '$lib/support/core';

interface AnalyticsInputs {
	sessions: SessionSummary[];
	diagnosticSessions: SessionSummary[];
	profile: UserSettings | undefined;
	/** `undefined` when the corpus chunk failed to load — consumers treat it as "no frequency weighting". */
	corpusFrequencies: FrequencyTable | undefined;
}

export async function loadAnalyticsInputs(): Promise<AnalyticsInputs> {
	const [sessions, diagnosticSessions, profile] = await Promise.all([
		getRecentSessions(),
		getRecentDiagnosticSessions(),
		getProfile()
	]);

	// Best-effort: corpus failures still render the chart (summarizeBigrams falls back to freq=1).
	let corpusFrequencies: FrequencyTable | undefined;
	try {
		const corpus = await loadBuiltinCorpus(profile?.language ?? 'en');
		corpusFrequencies = corpus.bigramFrequencies;
	} catch {
		corpusFrequencies = undefined;
	}

	return { sessions, diagnosticSessions, profile, corpusFrequencies };
}
