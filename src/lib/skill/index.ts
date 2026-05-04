/**
 * Skill
 * Measures how well the user types each bigram.
 *
 * Owns bigram classification (slow/fast, accurate/error-prone), extraction
 * of per-bigram aggregates from a keystroke stream, the diagnostic report
 * (baseline WPM), and the live views the planner reads (priority targets,
 * undertrained). Does not persist anything — `session` writes aggregates,
 * `support/storage` hosts them.
 */
export { extractBigramAggregates } from './extraction';
export { generateDiagnosticReport } from './engine';
export { summarizeBigrams, buildLivePriorityTargets, buildLiveUndertrained } from './assessment';
export type { BigramSummary } from './assessment';
export { classifyBigram, summarizeSamples } from './classification';
