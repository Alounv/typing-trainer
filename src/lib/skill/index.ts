/**
 * Skill — keystrokes to judgement. Measures on read rather than storing what it
 * measured, which is what lets a threshold change re-score history. Persists
 * nothing itself.
 */
export { annotateFirstInputs } from './postprocess';
export { encodeStream } from './stream-codec';
export { buildWordIndex } from './word-index';
export { hydrateSession, hydrateSessions } from './hydrate';
export { summarizeBigrams } from './assessment';
export type { BigramSummary } from './assessment';
export { classifyBigram, summarizeSamples } from './classification';
export { computeAllBigramDebts } from './debt';
export { assessPacing } from './pacing';
export type { PacingAssessment, PacingInput, PacingVerdict } from './pacing';
