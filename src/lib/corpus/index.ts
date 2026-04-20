/**
 * `corpus` lib — public API surface.
 *
 * Text-corpus registry, loading, sentence/quote selection. The
 * `normalize`, `merge`, and `custom` helpers are used only within the
 * corpus lib (ingestion pipeline) and stay internal.
 */
export * from './types';
export * from './registry';
export * from './loader';
export * from './quotes';
export * from './selection';
