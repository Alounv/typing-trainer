import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	activateBonusRound,
	applyBonusBaseline,
	readActiveBaseline
} from './bonus-round';

/**
 * `.svelte.test.ts` suffix routes this suite to the browser project so
 * `sessionStorage` is a real implementation — mocking it by hand would
 * miss the storage-unavailable guards the module depends on in SSR.
 */

const STORAGE_KEY = 'scheduler.bonusRound';

describe('bonus-round', () => {
	beforeEach(() => {
		sessionStorage.removeItem(STORAGE_KEY);
	});

	afterEach(() => {
		sessionStorage.removeItem(STORAGE_KEY);
	});

	describe('readActiveBaseline', () => {
		it('returns empty when no bonus round has been activated', () => {
			expect(readActiveBaseline()).toEqual({});
		});

		it('returns the snapshot right after activation', () => {
			activateBonusRound({ 'bigram-drill': 2, 'real-text': 1 });
			expect(readActiveBaseline()).toEqual({ 'bigram-drill': 2, 'real-text': 1 });
		});

		it('clears a stale activation from a previous calendar day', () => {
			// Hand-plant a baseline dated 2000-01-01 so today's toDateString
			// will never match — simulates the tab sitting overnight.
			sessionStorage.setItem(
				STORAGE_KEY,
				JSON.stringify({
					activatedOnDay: new Date(2000, 0, 1).toDateString(),
					completedAtActivation: { 'bigram-drill': 3 }
				})
			);
			expect(readActiveBaseline()).toEqual({});
			expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
		});

		it('drops a corrupt entry instead of throwing', () => {
			sessionStorage.setItem(STORAGE_KEY, '{not valid json');
			expect(readActiveBaseline()).toEqual({});
			expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
		});
	});

	describe('applyBonusBaseline', () => {
		it('is a no-op when no baseline is active', () => {
			const completed = { 'bigram-drill': 2, 'real-text': 1 };
			expect(applyBonusBaseline(completed, {})).toEqual(completed);
		});

		it('returns zero for types whose completions match the baseline exactly', () => {
			// Immediately after activating a bonus round, the live counts and
			// the baseline are identical — effective completed is zero, so
			// the planner re-emits the full plan.
			const completed = { 'bigram-drill': 4, 'real-text': 4 };
			const baseline = { 'bigram-drill': 4, 'real-text': 4 };
			expect(applyBonusBaseline(completed, baseline)).toEqual({});
		});

		it('carries forward completions past the baseline', () => {
			// User activated bonus at (4, 4) and has since completed one
			// more drill → effective is (1, 0).
			const completed = { 'bigram-drill': 5, 'real-text': 4 };
			const baseline = { 'bigram-drill': 4, 'real-text': 4 };
			expect(applyBonusBaseline(completed, baseline)).toEqual({ 'bigram-drill': 1 });
		});

		it('floors at zero if the baseline somehow exceeds live counts', () => {
			// Defensive: shouldn't happen in practice, but a clock-skew or
			// manually-cleared session log shouldn't surface negative credits.
			const completed = { 'bigram-drill': 1 };
			const baseline = { 'bigram-drill': 4 };
			expect(applyBonusBaseline(completed, baseline)).toEqual({});
		});
	});
});
