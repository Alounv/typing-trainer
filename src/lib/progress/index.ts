/**
 * `progress` lib — public API surface.
 *
 * Analytics loader, trend-series metrics, and celebration detection. The
 * chart components under `components/` are Svelte files reached via their
 * file paths (not barreled — `.svelte` doesn't re-export cleanly through
 * a `.ts` index).
 */
export * from './analytics-loader';
export * from './metrics';
export * from './celebrations';
