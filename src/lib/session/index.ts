/**
 * `session` lib — public API surface.
 *
 * The runtime `SessionRunner`, save-path, and the summary-page loader.
 * `delta` is consumed only by `summary-loader` and stays internal.
 * Components under `components/` are Svelte files reached via their file
 * paths. Shared session data types (`SessionSummary`, `SessionType`,
 * `SessionConfig`) live in `$lib/core` — see [ARCHITECTURE.md](../../ARCHITECTURE.md).
 */
export * from './runner';
export * from './persistence';
export * from './summary-loader';
