import { CLASSIFICATION_ORDER, type DisplayedClassification } from './classificationDisplay';

export const SWATCH_W = 30;
export const SWATCH_H = 8;
const GAP = 8;
export const NEW_W = 14;
const ARROW_END_GAP = 4;
export const TRACK_Y = 32;
const ARROW_TOP_Y = 4;

export const TOTAL_WIDTH = NEW_W + GAP + 4 * SWATCH_W + 3 * GAP;
export const TOTAL_HEIGHT = TRACK_Y + SWATCH_H + 2;

type StageKey = 'new' | DisplayedClassification;

interface StageCenter {
	key: StageKey;
	cx: number;
}

/** Center x for each stage (`new` first, then the four real stages in order). */
export function stageCenters(): StageCenter[] {
	const out: StageCenter[] = [];
	let x = 0;
	out.push({ key: 'new', cx: x + NEW_W / 2 });
	x += NEW_W + GAP;
	for (const cls of CLASSIFICATION_ORDER) {
		out.push({ key: cls, cx: x + SWATCH_W / 2 });
		x += SWATCH_W + GAP;
	}
	return out;
}

interface ArrowGeometry {
	fromCx: number;
	toCx: number;
	arcHeight: number;
	path: string;
}

/** Quadratic-Bezier arrow from the `from` stage to the `to` stage, arching above the track. */
export function arrowGeometry(
	from: DisplayedClassification | null,
	to: DisplayedClassification
): ArrowGeometry {
	const centers = stageCenters();
	const fromKey: StageKey = from ?? 'new';
	const fromCx = centers.find((c) => c.key === fromKey)!.cx;
	const toCx = centers.find((c) => c.key === to)!.cx;
	const arcHeight = Math.max(10, Math.min(TRACK_Y - ARROW_TOP_Y, Math.abs(toCx - fromCx) * 0.5));
	// Endpoints sit slightly above the track so the arrowhead doesn't touch the swatches.
	const endY = TRACK_Y - ARROW_END_GAP;
	const path = `M ${fromCx} ${endY} Q ${(fromCx + toCx) / 2} ${TRACK_Y - arcHeight} ${toCx} ${endY}`;
	return { fromCx, toCx, arcHeight, path };
}
