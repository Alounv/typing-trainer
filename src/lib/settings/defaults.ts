/**
 * Factory defaults for the per-session word budgets on `UserSettings`.
 *
 * Lives here (not in `practice/`) because these are profile-shape knobs:
 * `buildDefaultProfile()` needs them at module-init time to construct the
 * initial settings object, and routing that through `practice` creates a
 * load-order cycle (`settings/profile` → `practice` → `session-loader` →
 * `settings/profile`).
 *
 * The practice loaders read the *resolved* values off the profile; they
 * only need these constants as fallbacks when a caller passes in no
 * profile (tests, direct-nav entry points). Keeping defaults here and
 * having practice read from settings keeps the dependency one-way:
 * `practice → settings`, never back.
 */
export const DEFAULT_BIGRAM_DRILL_WORD_BUDGET = 50;
export const DEFAULT_REAL_TEXT_WORD_BUDGET = 25;
export const DEFAULT_DIAGNOSTIC_WORD_BUDGET = 100;
