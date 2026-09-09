// `fake-indexeddb/auto` must come before any import that touches Dexie —
// Dexie opens its connection at module-load time, and we want it to bind
// against the in-memory shim rather than a real IndexedDB.
import 'fake-indexeddb/auto';

import { beforeEach, describe, expect, it } from 'vitest';
import { getProfile, saveProfile } from './profile';
import type { UserSettings } from '../support/core/types';
import { clearAll } from '../support/storage/service';

describe('settings/profile — round-trip', () => {
	beforeEach(async () => {
		await clearAll();
	});

	it('returns undefined before the first save', async () => {
		expect(await getProfile()).toBeUndefined();
	});

	it('migrates legacy languages/corpusIds shape on read', async () => {
		const legacy = { languages: ['fr', 'en'], corpusIds: ['fr', 'en'] };
		await saveProfile(legacy as unknown as UserSettings);
		expect(await getProfile()).toEqual({ language: 'fr' });
	});
});
