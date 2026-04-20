/**
 * `practice` lib — public API surface.
 *
 * The "what to practice next" domain. External callers get the two route
 * loaders (`dashboard-loader`, `session-loader`) and the planned-session
 * types.
 *
 * Deliberately internal: `planner`, `graduation-filter`, `planned`,
 * `bonus-round`, and the text-generator internals — all composed by the
 * two loaders and never needed directly by a route or another lib.
 *
 * Word-budget defaults (`DEFAULT_*_WORD_BUDGET`) live in `settings/defaults`
 * so `settings/profile`'s factory-profile builder can reach them without
 * cycling back through a practice-loader load that would re-enter settings.
 */
export * from './types';
export * from './dashboard-loader';
export * from './session-loader';
