// `fake-indexeddb/auto` must come before any import that touches Dexie —
// Dexie opens its connection at module-load time, and we want it to bind
// against the in-memory shim rather than a real IndexedDB.
import 'fake-indexeddb/auto';

import { beforeEach, describe, expect, it } from 'vitest';
import { getProfile, saveProfile, type UserSettings } from './profile';
import { clearAll } from '../storage/service';

describe('settings/profile — round-trip', () => {
	beforeEach(async () => {
		await clearAll();
	});

	it('round-trips user settings (singleton row)', async () => {
		const settings: UserSettings = {
			languages: ['fr', 'en'],
			corpusIds: ['fr', 'en']
		};
		await saveProfile(settings);
		expect(await getProfile()).toEqual(settings);

		// Overwriting replaces — not merges.
		const next: UserSettings = { ...settings, languages: ['en'] };
		await saveProfile(next);
		expect(await getProfile()).toEqual(next);
	});

	it('returns undefined before the first save', async () => {
		expect(await getProfile()).toBeUndefined();
	});
});
