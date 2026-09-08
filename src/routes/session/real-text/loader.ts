import { loadBuiltinCorpus, loadQuoteBank, hasQuoteBank, generateText } from '$lib/corpus';
import {
	CHARS_PER_WORD,
	DEFAULT_REAL_TEXT_WORD_BUDGET,
	DEFAULT_THRESHOLDS
} from '$lib/support/core';
import { getProfile } from '$lib/settings';
import { consumePlannedSession } from '$lib/plan';
import { getRecentSessions } from '$lib/support/storage';
import { computeAllBigramDebts, hydrateSessions } from '$lib/skill';

interface RealTextSessionInputs {
	text: string;
}

export async function prepareRealTextSession(): Promise<RealTextSessionInputs> {
	const planned = consumePlannedSession('real-text');
	const profile = await getProfile();
	const wordBudget =
		planned?.config.wordBudget ?? profile?.wordBudgets?.realText ?? DEFAULT_REAL_TEXT_WORD_BUDGET;
	const targetChars = wordBudget * CHARS_PER_WORD;
	const language = profile?.language ?? 'en';
	const secondaryMix = profile?.secondaryMix ?? 0;
	const secondaryLanguage =
		profile?.secondaryLanguage && profile.secondaryLanguage !== language && secondaryMix > 0
			? profile.secondaryLanguage
			: undefined;
	const thresholds = profile?.thresholds ?? DEFAULT_THRESHOLDS;

	const [bank, corpus, secondaryBank, recentRows] = await Promise.all([
		hasQuoteBank(language) ? loadQuoteBank(language) : Promise.resolve(undefined),
		loadBuiltinCorpus(language),
		secondaryLanguage && hasQuoteBank(secondaryLanguage)
			? loadQuoteBank(secondaryLanguage)
			: Promise.resolve(undefined),
		getRecentSessions()
	]);

	// The only read here that decodes keystroke streams. It buys the whole point
	// of the session: which passage comes next. An empty map (no history yet)
	// leaves the assembler on plain sampling.
	const bigramDebts = computeAllBigramDebts(hydrateSessions(recentRows, thresholds), thresholds);

	const seq = generateText({
		kind: 'real-text',
		corpus,
		quoteBank: bank,
		secondaryQuoteBank: secondaryBank,
		secondaryMix,
		targetLengthChars: targetChars,
		bigramDebts
	});
	return { text: seq.text };
}
