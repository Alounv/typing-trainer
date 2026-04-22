/**
 * `progress` lib — public API surface.
 *
 * Analytics loader, summary-page loader, trend-series metrics, session-delta
 * (prior-vs-current comparison), and celebration detection. The chart + delta
 * components under `components/` are Svelte files reached via their file
 * paths (not barreled — `.svelte` doesn't re-export cleanly through a `.ts`
 * index).
 */
export * from './analytics-loader';
export * from './summary-loader';
export * from './metrics';
export * from './celebrations';
export * from './delta';
