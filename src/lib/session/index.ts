/**
 * `session` lib — public API surface.
 *
 * Session summary types, the runtime `SessionRunner`, save-path, and the
 * summary-page loader. `delta` is consumed only by `summary-loader` and
 * stays internal. Components under `components/` are Svelte files and
 * are reached via their file paths.
 */
export * from './types';
export * from './runner';
export * from './persistence';
export * from './summary-loader';
