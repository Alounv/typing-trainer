import { getRecentSessions, getRecentDiagnosticSessions } from '$lib/support/storage';
import { getProfile } from '$lib/settings';
import { hydrateSessions } from '$lib/skill';
import { loadBuiltinCorpus, type FrequencyTable } from '$lib/corpus';
import { DEFAULT_THRESHOLDS } from '$lib/support/core';
import type { ClassificationThresholds, SessionSummary, UserSettings } from '$lib/support/core';

interface AnalyticsInputs {
	sessions: SessionSummary[];
	diagnosticSessions: SessionSummary[];
	profile: UserSettings | undefined;
	/** `undefined` when the corpus chunk failed to load — consumers treat it as "no frequency weighting". */
	corpusFrequencies: FrequencyTable | undefined;
	thresholds: ClassificationThresholds;
}

export async function loadAnalyticsInputs(): Promise<AnalyticsInputs> {
	// No cap: cumulative healthy-bigram-over-time needs full history to be accurate
	// for early dots (otherwise the rolling-window classifier sees a truncated past).
	const [sessionRows, diagnosticRows, profile] = await Promise.all([
		getRecentSessions(Number.POSITIVE_INFINITY),
		getRecentDiagnosticSessions(Number.POSITIVE_INFINITY),
		getProfile()
	]);

	// Bigram statistics are measured from the stored keystroke streams here, so
	// the charts reflect the thresholds in force now rather than whatever was
	// configured on the day each session was typed.
	const thresholds = profile?.thresholds ?? DEFAULT_THRESHOLDS;
	const sessions = hydrateSessions(sessionRows, thresholds);
	const diagnosticSessions = hydrateSessions(diagnosticRows, thresholds);

	// Best-effort: corpus failures still render the chart (summarizeBigrams falls back to freq=1).
	let corpusFrequencies: FrequencyTable | undefined;
	try {
		const corpus = await loadBuiltinCorpus(profile?.language ?? 'en');
		corpusFrequencies = corpus.bigramFrequencies;
	} catch {
		corpusFrequencies = undefined;
	}

	return {
		sessions,
		diagnosticSessions,
		profile,
		corpusFrequencies,
		thresholds
	};
}
