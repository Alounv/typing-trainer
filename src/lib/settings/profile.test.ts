// `fake-indexeddb/auto` must come before any import that touches Dexie —
// Dexie opens its connection at module-load time, and we want it to bind
// against the in-memory shim rather than a real IndexedDB.
import 'fake-indexeddb/auto';

import { beforeEach, describe, expect, it } from 'vitest';
import { buildDefaultProfile, getProfile, saveProfile, withDefaults } from './profile';
import { DEFAULT_SPEED_THRESHOLD_MS } from '../support/core';
import type { UserSettings } from '../support/core/types';
import { clearAll } from '../support/storage/service';

describe('settings/profile — round-trip', () => {
	beforeEach(async () => {
		await clearAll();
	});

	it('returns undefined before the first save', async () => {
		expect(await getProfile()).toBeUndefined();
	});

	it.each([
		{
			shape: 'languages/corpusIds arrays, before the collapse to one language',
			legacy: { languages: ['fr', 'en'], corpusIds: ['fr', 'en'] },
			expected: { language: 'fr' }
		},
		{
			// The only session type that survived was real text, so its budget is
			// still the right passage length — dropping it would silently reset
			// everyone who had tuned it.
			shape: 'a per-session-type word budget, before there was one session type',
			legacy: { language: 'en', wordBudgets: { realText: 60, bigramDrill: 12 } },
			expected: { language: 'en', passageWords: 60 }
		},
		{
			shape: 'an explicit passageWords, which wins over the legacy budget',
			legacy: { language: 'en', passageWords: 40, wordBudgets: { realText: 60 } },
			expected: { language: 'en', passageWords: 40 }
		},
		{
			// The planner is gone; its stored shape must not survive into the
			// profile the settings page renders.
			shape: 'a planStructure from the removed planner',
			legacy: { language: 'en', planStructure: { monday: 2 } },
			expected: { language: 'en' }
		}
	])('migrates $shape', async ({ legacy, expected }) => {
		await saveProfile(legacy as unknown as UserSettings);
		expect(await getProfile()).toEqual(expected);
	});
});

describe('settings/profile — defaults', () => {
	it('fills every field a stored profile predates', () => {
		const filled = withDefaults({ language: 'fr' });
		expect(filled).toEqual({ ...buildDefaultProfile(), language: 'fr' });
	});

	it('keeps a stored threshold while filling in its missing sibling', () => {
		// The two thresholds are set independently, so a profile written when
		// only one existed must not lose it — nor inherit `undefined` for the other.
		// The cast is the point: the current type demands both, but rows on disk
		// predate that and `withDefaults` is what makes them safe to render.
		const partial = { language: 'en', thresholds: { speedMs: 120 } } as UserSettings;
		const filled = withDefaults(partial);
		expect(filled.thresholds).toEqual({
			speedMs: 120,
			errorRate: buildDefaultProfile().thresholds!.errorRate
		});
	});

	it('hands each caller its own object, so one caller cannot mutate another', () => {
		// The settings page auto-saves while reset builds a fresh profile; a
		// shared reference would let one write bleed into the other.
		const first = buildDefaultProfile();
		first.thresholds!.speedMs = 999;
		expect(buildDefaultProfile().thresholds!.speedMs).toBe(DEFAULT_SPEED_THRESHOLD_MS);
	});
});
