/**
 * Corpus
 * Produces the text the user will type.
 *
 * Owns the shipped quote banks and the language-level bigram frequency tables,
 * and assembles a passage out of them. Real-text sessions *select* prose rather
 * than generate it, so the lever this domain offers is which quotes come next —
 * scored, when there is history, by how much outstanding bigram debt each one
 * repays per keystroke.
 */
export { hasCorpus, loadQuoteBank, loadBigramFrequencies } from './registry';
export { buildPassage } from './passage';
export type { FrequencyTable } from './types';
