/**
 * `typing` lib — public API surface.
 *
 * Types for raw keystroke events and the post-capture annotation step that
 * flags first-input errors. The `TypingSurface` component and the internal
 * `capture` helper are reached via their file paths — not barreled because
 * Svelte components don't re-export cleanly through a `.ts` index.
 */
export * from './types';
export * from './postprocess';
