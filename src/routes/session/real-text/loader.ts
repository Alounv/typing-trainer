import { loadBuiltinCorpus, loadQuoteBank, hasQuoteBank, generateText } from '$lib/corpus';
import { CHARS_PER_WORD, DEFAULT_REAL_TEXT_WORD_BUDGET } from '$lib/support/core';
import { getProfile } from '$lib/settings';
import { consumePlannedSession } from '$lib/plan';

interface RealTextSessionInputs {
	text: string;
}

export async function prepareRealTextSession(): Promise<RealTextSessionInputs> {
	// Quote bank is the primary source; corpus is the synth fallback.
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

	const [bank, corpus, secondaryBank] = await Promise.all([
		hasQuoteBank(language) ? loadQuoteBank(language) : Promise.resolve(undefined),
		loadBuiltinCorpus(language),
		secondaryLanguage && hasQuoteBank(secondaryLanguage)
			? loadQuoteBank(secondaryLanguage)
			: Promise.resolve(undefined)
	]);
	const seq = generateText({
		kind: 'real-text',
		corpus,
		quoteBank: bank,
		secondaryQuoteBank: secondaryBank,
		secondaryMix,
		targetLengthChars: targetChars
	});
	return { text: seq.text };
}
