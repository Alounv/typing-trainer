import { describe, expect, it } from 'vitest';
import { CLASSIFICATION_ORDER } from './classificationDisplay';
import { TOTAL_WIDTH, TRACK_Y, arrowGeometry, stageCenters } from './bigramMovementGeometry';

describe('stageCenters', () => {
	it('places "new" first followed by the four classifications in order', () => {
		const keys = stageCenters().map((c) => c.key);
		expect(keys).toEqual(['new', ...CLASSIFICATION_ORDER]);
	});

	it('produces strictly increasing x-centers within the total width', () => {
		const centers = stageCenters();
		for (let i = 1; i < centers.length; i++) {
			expect(centers[i].cx).toBeGreaterThan(centers[i - 1].cx);
		}
		expect(centers.at(-1)!.cx).toBeLessThan(TOTAL_WIDTH);
	});
});

describe('arrowGeometry', () => {
	it.each([
		{ from: null, to: 'acquisition' as const },
		{ from: null, to: 'healthy' as const },
		{ from: 'acquisition' as const, to: 'hasty' as const },
		{ from: 'acquisition' as const, to: 'healthy' as const },
		{ from: 'healthy' as const, to: 'fluency' as const }
	])('endpoints sit just above the track for $from → $to', ({ from, to }) => {
		const { fromCx, toCx, path } = arrowGeometry(from, to);
		expect(path.startsWith(`M ${fromCx} `)).toBe(true);
		expect(path).toContain(` ${toCx} `);
		// Endpoints should not land on the track itself — the arrow leaves a gap.
		expect(path).not.toContain(`M ${fromCx} ${TRACK_Y}`);
	});

	it('arc height grows with span', () => {
		const oneStep = arrowGeometry('acquisition', 'hasty').arcHeight;
		const threeStep = arrowGeometry('acquisition', 'healthy').arcHeight;
		expect(threeStep).toBeGreaterThan(oneStep);
	});

	it('treats null `from` as the "new" stage (left of acquisition)', () => {
		const fromNew = arrowGeometry(null, 'acquisition').fromCx;
		const fromAcquisition = arrowGeometry('acquisition', 'hasty').fromCx;
		expect(fromNew).toBeLessThan(fromAcquisition);
	});
});
