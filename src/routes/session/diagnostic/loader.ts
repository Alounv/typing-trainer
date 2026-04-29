import { loadBuiltinCorpus, loadQuoteBank, hasQuoteBank, generateText } from '$lib/corpus';
import { CHARS_PER_WORD, DEFAULT_DIAGNOSTIC_WORD_BUDGET } from '$lib/support/core';
import { getProfile } from '$lib/settings';

interface DiagnosticSessionInputs {
	text: string;
}

export async function prepareDiagnosticSession(): Promise<DiagnosticSessionInputs> {
	const profile = await getProfile();
	const corpus = await loadBuiltinCorpus(profile?.language ?? 'en');
	const quoteBank = hasQuoteBank(corpus.config.language)
		? await loadQuoteBank(corpus.config.language)
		: undefined;

	const wordBudget = profile?.wordBudgets?.diagnostic ?? DEFAULT_DIAGNOSTIC_WORD_BUDGET;
	const passage = generateText({
		kind: 'diagnostic',
		corpus,
		quoteBank,
		targetChars: wordBudget * CHARS_PER_WORD
	});
	return { text: passage.text };
}
