import type { BigramClassification } from '../support/core';

export type DisplayedClassification = Exclude<BigramClassification, 'unclassified'>;

/** Worst → best. "Moving right" always reads as "getting better". */
export const CLASSIFICATION_ORDER: DisplayedClassification[] = [
	'acquisition',
	'hasty',
	'fluency',
	'healthy'
];

/** DaisyUI-compatible semantic colors. Keep this single source of truth so
 *  the bar, badges, and movement diagrams stay in sync. */
export const CLASSIFICATION_COLOR: Record<DisplayedClassification, string> = {
	acquisition: 'bg-error',
	hasty: 'bg-warning',
	fluency: 'bg-info',
	healthy: 'bg-success'
};

/** SVG `fill` variant of the same palette. `bg-*` only sets background-color
 *  and won't paint <rect>/<circle>; SVG shapes need `fill-*`. */
export const CLASSIFICATION_FILL: Record<DisplayedClassification, string> = {
	acquisition: 'fill-error',
	hasty: 'fill-warning',
	fluency: 'fill-info',
	healthy: 'fill-success'
};

/** `text-*` variant — useful as `currentColor` driver for SVG strokes/markers. */
export const CLASSIFICATION_TEXT: Record<DisplayedClassification, string> = {
	acquisition: 'text-error',
	hasty: 'text-warning',
	fluency: 'text-info',
	healthy: 'text-success'
};
