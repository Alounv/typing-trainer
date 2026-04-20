/**
 * Analytics-page loader — pulls the raw inputs the analytics route needs
 * so the route stays UI-only. Kept separate from `progress/metrics` so
 * metrics stay pure / synchronous / trivially testable.
 *
 * Corpus loading is best-effort: if it fails (e.g. network hiccup on a
 * code-split chunk), we still want the WPM chart to render —
 * `summarizeBigrams` falls back to `freq=1` when the corpus is absent.
 */
import { getRecentSessions } from '../storage';
import { getProfile, type UserSettings } from '../settings';
import { isBuiltinCorpusId, loadBuiltinCorpus, type FrequencyTable } from '../corpus';
import type { SessionSummary } from '../session';

/**
 * A user could theoretically rack up thousands of sessions. 500 is a soft
 * cap that keeps the chart fast without truncating a realistic history —
 * revisit if the axis becomes illegible.
 */
const SESSION_CAP = 500;

/** Mirrors the session routes: English is the fall-back when the profile
 * is missing or points at a no-longer-supported corpus. */
const FALLBACK_CORPUS_ID = 'en';

export interface AnalyticsInputs {
	sessions: SessionSummary[];
	profile: UserSettings | undefined;
	/** `undefined` when the corpus chunk failed to load — consumers treat it as "no frequency weighting". */
	corpusFrequencies: FrequencyTable | undefined;
}

export async function loadAnalyticsInputs(): Promise<AnalyticsInputs> {
	const [sessions, profile] = await Promise.all([getRecentSessions(SESSION_CAP), getProfile()]);

	let corpusFrequencies: FrequencyTable | undefined;
	try {
		const pickedId = profile?.corpusIds?.[0];
		const corpusId = pickedId && isBuiltinCorpusId(pickedId) ? pickedId : FALLBACK_CORPUS_ID;
		const corpus = await loadBuiltinCorpus(corpusId);
		corpusFrequencies = corpus.bigramFrequencies;
	} catch {
		corpusFrequencies = undefined;
	}

	return { sessions, profile, corpusFrequencies };
}
