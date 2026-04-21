/**
 * `session` lib — public API surface.
 *
 * The runtime `SessionRunner`, save-path, and the summary-page loader.
 * Components under `components/` are Svelte files reached via their file
 * paths. Shared session data types (`SessionSummary`, `SessionType`,
 * `SessionConfig`) live in `$lib/core` — see [ARCHITECTURE.md](../../ARCHITECTURE.md).
 * Session-delta (prior-vs-current comparison) lives in `$lib/progress`.
 */
export * from './runner';
export * from './persistence';
export * from './summary-loader';
