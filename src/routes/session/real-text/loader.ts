import {
	loadBuiltinCorpus,
	isBuiltinCorpusId,
	loadQuoteBank,
	hasQuoteBank,
	generateRealTextSequence
} from '$lib/corpus';
import type { BuiltinCorpusId } from '$lib/corpus';
import { CHARS_PER_WORD, DEFAULT_REAL_TEXT_WORD_BUDGET } from '$lib/core';
import type { UserSettings } from '$lib/core';
import { getProfile } from '$lib/settings';
import { consumePlannedSession } from '$lib/plan';

const FALLBACK_CORPUS_ID: BuiltinCorpusId = 'en';

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
	const corpusId = resolveCorpusId(profile);
	const language = profile?.languages?.[0] ?? 'en';

	const [bank, corpus] = await Promise.all([
		hasQuoteBank(language) ? loadQuoteBank(language) : Promise.resolve(undefined),
		loadBuiltinCorpus(corpusId)
	]);
	const seq = generateRealTextSequence({
		quoteBank: bank,
		fallbackCorpus: corpus,
		options: { targetLengthChars: targetChars }
	});
	return { text: seq.text };
}

function resolveCorpusId(profile: UserSettings | undefined): BuiltinCorpusId {
	const pickedId = profile?.corpusIds?.[0];
	return pickedId && isBuiltinCorpusId(pickedId) ? pickedId : FALLBACK_CORPUS_ID;
}
