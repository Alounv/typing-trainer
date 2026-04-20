/**
 * `bigram` lib — public API surface.
 *
 * Covers the per-pair-of-characters domain: type definitions, classifier
 * thresholds + `classifyBigram`, and the event-to-aggregate extraction used
 * by the session runner.
 */
export * from './types';
export * from './classification';
export * from './extraction';
