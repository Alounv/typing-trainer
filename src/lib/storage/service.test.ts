// `fake-indexeddb/auto` must come before any import that touches Dexie —
// Dexie opens its connection at module-load time, and we want it to bind
// against the in-memory shim rather than a real IndexedDB.
import 'fake-indexeddb/auto';

import { beforeEach, describe, expect, it } from 'vitest';
import {
	clearAll,
	getBigramHistory,
	getDiagnosticRawData,
	getProfile,
	getProgressStore,
	getRecentSessions,
	getSession,
	saveProfile,
	saveProgressStore,
	saveSession
} from './service';
import type { SessionSummary } from '../session/types';
import type { BigramAggregate } from '../bigram/types';
import type { DiagnosticRawData } from '../diagnostic/types';
import type { UserSettings } from '../models';
import type { ProgressStore } from '../progress/types';

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

describe('storage service — round-trip', () => {
	beforeEach(async () => {
		await clearAll();
	});

	it('persists and reads back a session', async () => {
		const session = makeSession();
		await saveSession(session);
		expect(await getSession(session.id)).toEqual(session);
	});

	it('returns undefined for unknown sessions', async () => {
		expect(await getSession('does-not-exist')).toBeUndefined();
	});

	it('lists recent sessions newest-first, respecting the limit', async () => {
		await saveSession(makeSession({ id: 'a', timestamp: 1_000 }));
		await saveSession(makeSession({ id: 'b', timestamp: 3_000 }));
		await saveSession(makeSession({ id: 'c', timestamp: 2_000 }));

		const recent = await getRecentSessions(2);
		expect(recent.map((s) => s.id)).toEqual(['b', 'c']);
	});

	it('mirrors embedded aggregates into the bigram history table', async () => {
		await saveSession(
			makeSession({
				id: 's1',
				bigramAggregates: [
					makeAggregate({ bigram: 'th', sessionId: 's1', meanTime: 140 }),
					makeAggregate({ bigram: 'er', sessionId: 's1', meanTime: 180 })
				]
			})
		);
		await saveSession(
			makeSession({
				id: 's2',
				timestamp: 2_000,
				bigramAggregates: [makeAggregate({ bigram: 'th', sessionId: 's2', meanTime: 130 })]
			})
		);

		const thHistory = await getBigramHistory('th');
		expect(thHistory.map((a) => a.sessionId)).toEqual(['s2', 's1']);
		expect(thHistory.every((a) => a.bigram === 'th')).toBe(true);

		const erHistory = await getBigramHistory('er');
		expect(erHistory).toHaveLength(1);
		expect(erHistory[0].bigram).toBe('er');
	});

	it('persists raw keystroke events only when provided (diagnostic sessions)', async () => {
		const session = makeSession({ id: 'diag-1', type: 'diagnostic' });
		const rawData: DiagnosticRawData = {
			sessionId: 'diag-1',
			events: [
				{
					timestamp: 0,
					expected: 't',
					actual: 't',
					position: 0,
					wordIndex: 0,
					positionInWord: 0
				}
			]
		};
		await saveSession(session, rawData);
		expect(await getDiagnosticRawData('diag-1')).toEqual(rawData);

		// Drill sessions omit the raw-data argument — nothing should land in that table.
		const drill = makeSession({ id: 'drill-1', type: 'bigram-drill' });
		await saveSession(drill);
		expect(await getDiagnosticRawData('drill-1')).toBeUndefined();
	});

	it('round-trips user settings (singleton row)', async () => {
		const settings: UserSettings = {
			languages: ['fr', 'en'],
			corpusIds: ['fr-top-1000', 'en-top-1000']
		};
		await saveProfile(settings);
		expect(await getProfile()).toEqual(settings);

		// Overwriting replaces — not merges.
		const next: UserSettings = { ...settings, languages: ['en'] };
		await saveProfile(next);
		expect(await getProfile()).toEqual(next);
	});

	it('returns undefined for profile and progress store before the first save', async () => {
		expect(await getProfile()).toBeUndefined();
		expect(await getProgressStore()).toBeUndefined();
	});

	it('round-trips the progress store (singleton row)', async () => {
		const store: ProgressStore = {
			graduationHistory: [],
			classificationSnapshots: [],
			wpmHistory: [],
			sdmHistory: { values: [], current: 0, delta7d: 0, delta30d: 0 },
			errorFloorHistory: { values: [], current: 0, delta7d: 0, delta30d: 0 },
			diagnosticReports: []
		};
		await saveProgressStore(store);
		expect(await getProgressStore()).toEqual(store);
	});

	it('clearAll wipes every table', async () => {
		await saveSession(makeSession(), {
			sessionId: 's1',
			events: []
		});
		await saveProfile({ languages: ['en'], corpusIds: ['en-top-1000'] });

		await clearAll();

		expect(await getSession('s1')).toBeUndefined();
		expect(await getDiagnosticRawData('s1')).toBeUndefined();
		expect(await getBigramHistory('th')).toEqual([]);
		expect(await getProfile()).toBeUndefined();
		expect(await getProgressStore()).toBeUndefined();
	});
});
