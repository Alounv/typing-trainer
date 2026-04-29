/**
 * Corpus
 * Produces the text the user will type.
 *
 * Owns the built-in wordlists and quote banks, language-level bigram
 * frequency tables, and the generators that assemble them into drill
 * passages (bigram drills, real text, diagnostic samples). Does not
 * decide *which* drill to run — that's `plan`'s job.
 */
export { isBuiltinCorpusId, loadBuiltinCorpus, hasQuoteBank, loadQuoteBank } from './registry';
export type { FrequencyTable } from './types';
export { generateText } from './generate-text';
