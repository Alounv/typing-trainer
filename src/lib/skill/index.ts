/**
 * Skill
 * Measures how well the user types each bigram.
 *
 * Owns the whole path from keystrokes to judgement: the stream codec, first-input
 * post-processing, per-bigram extraction and classification (slow/fast,
 * accurate/error-prone), the end-of-session pacing verdict, the diagnostic report
 * (baseline WPM), and the live views the planner reads (priority targets,
 * undertrained).
 *
 * Stored rows hold the keystroke stream; the aggregates every consumer reads are
 * measured here on read (`hydrateSession`), so a stored row and a threshold change
 * are all it takes to re-score history. Does not persist anything — `session` writes
 * the stream, `support/storage` hosts it.
 */
export { extractBigramAggregates } from './extraction';
export { annotateFirstInputs } from './postprocess';
export type { AnnotatedKeystrokeEvent } from './postprocess';
export { encodeStream, decodeStream } from './stream-codec';
export { buildWordIndex } from './word-index';
export { hydrateSession, hydrateSessions } from './hydrate';
export { generateDiagnosticReport } from './engine';
export { summarizeBigrams, buildLivePriorityTargets, buildLiveUndertrained } from './assessment';
export type { BigramSummary } from './assessment';
export { classifyBigram, summarizeSamples } from './classification';
export { computeBigramDebts } from './debt';
export { assessPacing } from './pacing';
export type { PacingAssessment, PacingInput, PacingVerdict } from './pacing';
