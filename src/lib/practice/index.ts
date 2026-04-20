/**
 * `practice` lib — public API surface.
 *
 * The "what to practice next" domain. External callers get the two route
 * loaders (`dashboard-loader`, `session-loader`), the planned-session
 * types, and the per-type default word budgets used by `settings/profile`
 * for the factory defaults.
 *
 * Deliberately internal: `planner`, `graduation-filter`, `planned`,
 * `bonus-round`, and the text-generator internals — all composed by the
 * two loaders and never needed directly by a route or another lib.
 */
export * from './types';
export * from './dashboard-loader';
export * from './session-loader';
export { DEFAULT_BIGRAM_DRILL_WORD_BUDGET } from './bigram-drill';
export { DEFAULT_REAL_TEXT_WORD_BUDGET } from './real-text';
export { DEFAULT_DIAGNOSTIC_WORD_BUDGET } from './diagnostic-sampler';
