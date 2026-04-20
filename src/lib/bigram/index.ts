/**
 * `bigram` lib — public API surface.
 *
 * Covers the per-pair-of-characters runtime: classifier thresholds +
 * `classifyBigram`, and the event-to-aggregate extraction used by the
 * session runner. The data-shape types (`BigramAggregate`,
 * `BigramClassification`, `BigramSample`) live in `$lib/core` — see
 * [ARCHITECTURE.md](../../ARCHITECTURE.md).
 */
export * from './classification';
export * from './extraction';
