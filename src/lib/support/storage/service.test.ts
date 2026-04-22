// `fake-indexeddb/auto` must come before any import that touches Dexie —
// Dexie opens its connection at module-load time, and we want it to bind
// against the in-memory shim rather than a real IndexedDB.
import 'fake-indexeddb/auto';

import { beforeEach, describe, expect, it } from 'vitest';
import { clearAll, getBigramHistory, getRecentSessions, getSession } from './service';
import { saveProfile } from '../../settings/profile';
import { saveSessionFixture as saveSession } from '../../test-utils/fixtures';
import type { SessionSummary, BigramAggregate, DiagnosticReport } from '../core/types';

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

	it('attaches a diagnostic report to the summary round-trip', async () => {
		const report: DiagnosticReport = { baselineWPM: 60 };
		await saveSession(makeSession({ id: 'diag-1', type: 'diagnostic', diagnosticReport: report }));

		const roundTripped = await getSession('diag-1');
		expect(roundTripped?.diagnosticReport).toEqual(report);
	});

	it('clearAll wipes every table', async () => {
		await saveSession(makeSession());
		await saveProfile({ languages: ['en'], corpusIds: ['en'] });

		await clearAll();

		expect(await getSession('s1')).toBeUndefined();
		expect(await getBigramHistory('th')).toEqual([]);
	});
});
