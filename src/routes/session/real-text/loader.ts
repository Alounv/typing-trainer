import { loadQuoteBank, hasQuoteBank, generateText } from '$lib/corpus';
import {
	CHARS_PER_WORD,
	DEFAULT_REAL_TEXT_WORD_BUDGET,
	DEFAULT_THRESHOLDS
} from '$lib/support/core';
import { getProfile } from '$lib/settings';
import { getRecentSessions } from '$lib/support/storage';
import { computeAllBigramDebts, hydrateSessions } from '$lib/skill';

interface RealTextSessionInputs {
	text: string;
}

export async function prepareRealTextSession(): Promise<RealTextSessionInputs> {
	const profile = await getProfile();
	const wordBudget = profile?.wordBudgets?.realText ?? DEFAULT_REAL_TEXT_WORD_BUDGET;
	const language = profile?.language ?? 'en';
	const secondaryMix = profile?.secondaryMix ?? 0;
	const secondaryLanguage =
		profile?.secondaryLanguage && profile.secondaryLanguage !== language && secondaryMix > 0
			? profile.secondaryLanguage
			: undefined;
	const thresholds = profile?.thresholds ?? DEFAULT_THRESHOLDS;

	// Real prose is the only material, so a language with no bank has nothing to
	// offer — better to say so than to fall back to synthesised text.
	if (!hasQuoteBank(language)) {
		throw new Error(`No quote bank for ${language}, so there is no prose to type.`);
	}

	const [bank, secondaryBank, recentRows] = await Promise.all([
		loadQuoteBank(language),
		secondaryLanguage && hasQuoteBank(secondaryLanguage)
			? loadQuoteBank(secondaryLanguage)
			: Promise.resolve(undefined),
		getRecentSessions()
	]);

	// The only read here that decodes keystroke streams. It buys the whole point
	// of the session: which passage comes next. An empty map (no history yet)
	// leaves the assembler on uniform sampling.
	const bigramDebts = computeAllBigramDebts(hydrateSessions(recentRows, thresholds), thresholds);

	const seq = generateText({
		quoteBank: bank,
		secondaryQuoteBank: secondaryBank,
		secondaryMix,
		targetLengthChars: wordBudget * CHARS_PER_WORD,
		bigramDebts
	});
	return { text: seq.text };
}
