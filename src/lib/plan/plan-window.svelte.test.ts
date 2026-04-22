import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readPlanStartedAt, setPlanStartedAt } from './plan-window';

/**
 * `.svelte.test.ts` → browser project, so `sessionStorage` is real (matches
 * prod wiring; faking it would miss the storage-unavailable guards).
 */

const STORAGE_KEY = 'scheduler.planStartedAt';

describe('plan-window', () => {
	beforeEach(() => sessionStorage.removeItem(STORAGE_KEY));
	afterEach(() => sessionStorage.removeItem(STORAGE_KEY));

	it('reads `0` when no cursor has been set', () => {
		expect(readPlanStartedAt()).toBe(0);
	});

	it('set + read roundtrip', () => {
		const ts = Date.now();
		setPlanStartedAt(ts);
		expect(readPlanStartedAt()).toBe(ts);
	});

	it('drops a cursor from a previous calendar day', () => {
		const yesterday = new Date();
		yesterday.setDate(yesterday.getDate() - 1);
		sessionStorage.setItem(STORAGE_KEY, String(yesterday.getTime()));
		expect(readPlanStartedAt()).toBe(0);
		expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
	});

	it('drops a non-numeric entry instead of returning NaN', () => {
		sessionStorage.setItem(STORAGE_KEY, 'not a number');
		expect(readPlanStartedAt()).toBe(0);
		expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
	});
});
