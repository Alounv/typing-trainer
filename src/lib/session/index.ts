/**
 * `session` lib — public API surface.
 *
 * The runtime `SessionRunner` and save-path. Components under `components/`
 * are Svelte files reached via their file paths. Shared session data types
 * (`SessionSummary`, `SessionType`, `SessionConfig`) live in `$lib/core` —
 * see [ARCHITECTURE.md](../../ARCHITECTURE.md). The summary-page loader
 * and session-delta (prior-vs-current comparison) live in `$lib/progress`.
 */
export * from './runner';
export * from './persistence';
