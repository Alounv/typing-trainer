// Dexie opens its connection at module-load time; the fake-indexeddb shim
// must be installed before any import that pulls in the storage layer.
import 'fake-indexeddb/auto';

import { beforeEach, describe, expect, it } from 'vitest';
import {
	APP_TAG,
	SCHEMA_VERSION,
	exportAll,
	importAll,
	ImportValidationError,
	type ExportFile
} from './data-transfer';
import { getProfile, saveProfile } from './profile';
import { clearAll, getBigramHistory, getRecentSessions, getSession } from '../support/storage/service';
import { saveSession } from '../session/persistence';
import type { SessionSummary, UserSettings, BigramAggregate } from '../support/core/types';

function makeAggregate(overrides: Partial<BigramAggregate> = {}): BigramAggregate {
	return {
		bigram: 'th',
		sessionId: 's1',
		occurrences: 12,
		meanTime: 140,
		stdTime: 22,
		errorCount: 0,
		errorRate: 0,
		classification: 'healthy',
		...overrides
	};
}

function makeSession(overrides: Partial<SessionSummary> = {}): SessionSummary {
	return {
		id: 's1',
		timestamp: 1_000,
		type: 'bigram-drill',
		durationMs: 300_000,
		wpm: 68,
		errorRate: 0.03,
		bigramsTargeted: ['th'],
		bigramAggregates: [makeAggregate()],
		...overrides
	};
}

const sampleProfile: UserSettings = {
	languages: ['fr', 'en'],
	corpusIds: ['fr', 'en']
};

describe('storage export/import', () => {
	beforeEach(async () => {
		await clearAll();
	});

	describe('exportAll', () => {
		it('stamps the header with app tag, schema version, and a timestamp', async () => {
			const before = Date.now();
			const file = await exportAll();
			const after = Date.now();

			expect(file.app).toBe(APP_TAG);
			expect(file.schemaVersion).toBe(SCHEMA_VERSION);
			expect(file.exportedAt).toBeGreaterThanOrEqual(before);
			expect(file.exportedAt).toBeLessThanOrEqual(after);
		});

		it('emits empty collections and null profile for a fresh DB', async () => {
			const file = await exportAll();
			expect(file.data.sessions).toEqual([]);
			expect(file.data.bigramRecords).toEqual([]);
			expect(file.data.profile).toBeNull();
		});

		it('captures sessions, mirrored bigram rows, and the profile singleton', async () => {
			await saveSession(makeSession());
			await saveProfile(sampleProfile);

			const file = await exportAll();

			expect(file.data.sessions).toHaveLength(1);
			expect(file.data.sessions[0].id).toBe('s1');
			expect(file.data.bigramRecords).toHaveLength(1);
			// `key` is the pre-joined (bigram, sessionId) primary key — it must survive the round-trip.
			expect(file.data.bigramRecords[0].key).toBe('th::s1');
			expect(file.data.profile).toEqual({ id: 'default', settings: sampleProfile });
		});

		it('is JSON-serializable end-to-end', async () => {
			await saveSession(makeSession());
			await saveProfile(sampleProfile);

			const file = await exportAll();
			// If any Dexie-proxied value leaked through, JSON.stringify would silently
			// drop it and the parsed copy wouldn't match.
			const roundTripped = JSON.parse(JSON.stringify(file));
			expect(roundTripped).toEqual(file);
		});
	});

	describe('importAll — success paths', () => {
		it('round-trips: seed → export → clear → import recovers identical state', async () => {
			await saveSession(
				makeSession({
					id: 's1',
					bigramAggregates: [
						makeAggregate({ bigram: 'th', sessionId: 's1', meanTime: 140 }),
						makeAggregate({ bigram: 'er', sessionId: 's1', meanTime: 180 })
					]
				})
			);
			await saveSession(makeSession({ id: 's2', timestamp: 2_000 }));
			await saveProfile(sampleProfile);

			const file = await exportAll();
			await clearAll();
			// Sanity: the wipe actually happened before we test recovery.
			expect(await getRecentSessions(10)).toEqual([]);

			await importAll(file);

			const recovered = await getRecentSessions(10);
			expect(recovered.map((s) => s.id)).toEqual(['s2', 's1']);
			expect(await getProfile()).toEqual(sampleProfile);

			const thHistory = await getBigramHistory('th');
			expect(thHistory.map((a) => a.sessionId)).toEqual(['s1']);
			const erHistory = await getBigramHistory('er');
			expect(erHistory).toHaveLength(1);
		});

		it('accepts a freshly parsed JSON blob (not only the original object)', async () => {
			await saveSession(makeSession());
			await saveProfile(sampleProfile);
			const file = await exportAll();
			await clearAll();

			// Users hand us whatever `FileReader` gives back — make sure a plain
			// JSON round-trip (no class instances, no prototypes) still imports cleanly.
			await importAll(JSON.parse(JSON.stringify(file)));

			expect(await getSession('s1')).toBeDefined();
			expect(await getProfile()).toEqual(sampleProfile);
		});

		it('replaces — never merges — existing data', async () => {
			// Pre-existing rows that should NOT survive the import.
			await saveSession(makeSession({ id: 'pre-existing', timestamp: 500 }));
			await saveProfile({ languages: ['en'], corpusIds: ['en'] });

			const payload: ExportFile = {
				app: APP_TAG,
				schemaVersion: SCHEMA_VERSION,
				exportedAt: Date.now(),
				data: {
					sessions: [makeSession({ id: 'imported', timestamp: 9_999 })],
					bigramRecords: [],
					profile: { id: 'default', settings: sampleProfile }
				}
			};
			await importAll(payload);

			expect(await getSession('pre-existing')).toBeUndefined();
			expect(await getSession('imported')).toBeDefined();
			expect(await getProfile()).toEqual(sampleProfile);
		});

		it('handles a null profile in the payload (pre-onboarding export)', async () => {
			await saveProfile(sampleProfile);

			await importAll({
				app: APP_TAG,
				schemaVersion: SCHEMA_VERSION,
				exportedAt: 0,
				data: { sessions: [], bigramRecords: [], profile: null }
			});

			expect(await getProfile()).toBeUndefined();
		});
	});

	describe('importAll — validation', () => {
		function validPayload(): ExportFile {
			return {
				app: APP_TAG,
				schemaVersion: SCHEMA_VERSION,
				exportedAt: 0,
				data: { sessions: [], bigramRecords: [], profile: null }
			};
		}

		it.each([
			['a string', '"hello"'],
			['null', 'null'],
			['an array', '[]']
		])('rejects payloads that are %s at the top level', async (_label, raw) => {
			await expect(importAll(JSON.parse(raw))).rejects.toBeInstanceOf(ImportValidationError);
		});

		it('rejects an export tagged for a different app', async () => {
			const bad = { ...validPayload(), app: 'some-other-app' };
			await expect(importAll(bad)).rejects.toThrow(/typing-trainer/);
		});

		it('rejects exports with no schemaVersion at all', async () => {
			const bad: Record<string, unknown> = { ...validPayload() };
			delete bad.schemaVersion;
			await expect(importAll(bad)).rejects.toThrow(/schemaVersion/);
		});

		it('rejects exports from a newer build (unknown-forward)', async () => {
			const bad = { ...validPayload(), schemaVersion: SCHEMA_VERSION + 1 };
			await expect(importAll(bad)).rejects.toThrow(/newer build/);
		});

		it('rejects exports from an older schema (no migrator yet)', async () => {
			const bad = { ...validPayload(), schemaVersion: 0 };
			await expect(importAll(bad)).rejects.toThrow(/older schema/);
		});

		it('rejects malformed session rows', async () => {
			const bad = {
				...validPayload(),
				data: {
					sessions: [{ id: 's1' /* missing timestamp */ }],
					bigramRecords: [],
					profile: null
				}
			};
			await expect(importAll(bad)).rejects.toThrow(/session row/);
		});

		it('rejects malformed bigramRecord rows', async () => {
			const bad = {
				...validPayload(),
				data: {
					sessions: [],
					bigramRecords: [{ bigram: 'th' /* missing key */ }],
					profile: null
				}
			};
			await expect(importAll(bad)).rejects.toThrow(/bigramRecord row/);
		});

		it('leaves existing data untouched when validation fails', async () => {
			await saveSession(makeSession({ id: 'keep-me' }));
			await saveProfile(sampleProfile);

			await expect(importAll({ app: 'not-us' })).rejects.toBeInstanceOf(ImportValidationError);

			// Validation runs before the wipe — nothing should have been cleared.
			expect(await getSession('keep-me')).toBeDefined();
			expect(await getProfile()).toEqual(sampleProfile);
		});
	});
});
