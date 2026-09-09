import { loadQuoteBank, hasCorpus, buildPassage } from '$lib/corpus';
import { CHARS_PER_WORD, DEFAULT_PASSAGE_WORDS } from '$lib/support/core';
import { getProfile } from '$lib/settings';
import { getRecentSessions } from '$lib/support/storage';
import { computeAllBigramDebts, hydrateSessions } from '$lib/skill';

export async function prepareRealTextSession(): Promise<{ text: string }> {
	const profile = await getProfile();
	const language = profile?.language ?? 'en';
	const secondaryMix = profile?.secondaryMix ?? 0;
	const secondaryLanguage =
		profile?.secondaryLanguage && profile.secondaryLanguage !== language && secondaryMix > 0
			? profile.secondaryLanguage
			: undefined;

	// Real prose is the only material, so a language with no bank has nothing to
	// offer — better to say so than to fall back to synthesised text.
	if (!hasCorpus(language)) {
		throw new Error(`No quote bank for ${language}, so there is no prose to type.`);
	}

	const [bank, secondaryBank, recentRows] = await Promise.all([
		loadQuoteBank(language),
		secondaryLanguage && hasCorpus(secondaryLanguage)
			? loadQuoteBank(secondaryLanguage)
			: undefined,
		getRecentSessions()
	]);

	// The only read here that decodes keystroke streams. It buys the whole point
	// of the session: which passage comes next. An empty map (no history yet)
	// leaves the assembler on uniform sampling.
	const bigramDebts = computeAllBigramDebts(hydrateSessions(recentRows));

	return {
		text: buildPassage({
			bank,
			secondaryBank,
			secondaryMix,
			targetLengthChars: (profile?.passageWords ?? DEFAULT_PASSAGE_WORDS) * CHARS_PER_WORD,
			bigramDebts
		})
	};
}
