import {
	loadBuiltinCorpus,
	isBuiltinCorpusId,
	loadQuoteBank,
	hasQuoteBank,
	generateText
} from '$lib/corpus';
import type { BuiltinCorpusId } from '$lib/corpus';
import { CHARS_PER_WORD, DEFAULT_DIAGNOSTIC_WORD_BUDGET } from '$lib/core';
import type { UserSettings } from '$lib/core';
import { getProfile } from '$lib/settings';

const FALLBACK_CORPUS_ID: BuiltinCorpusId = 'en';

interface DiagnosticSessionInputs {
	text: string;
}

export async function prepareDiagnosticSession(): Promise<DiagnosticSessionInputs> {
	const profile = await getProfile();
	const corpusId = resolveCorpusId(profile);

	const corpus = await loadBuiltinCorpus(corpusId);
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

function resolveCorpusId(profile: UserSettings | undefined): BuiltinCorpusId {
	const pickedId = profile?.corpusIds?.[0];
	return pickedId && isBuiltinCorpusId(pickedId) ? pickedId : FALLBACK_CORPUS_ID;
}
