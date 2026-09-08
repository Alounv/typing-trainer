// `fake-indexeddb/auto` must come before any import that touches Dexie —
// Dexie opens its connection at module-load time, and we want it to bind
// against the in-memory shim rather than a real IndexedDB.
import 'fake-indexeddb/auto';

import { beforeEach, describe, expect, it } from 'vitest';
import { clearAll, getBigramHistory, getRecentSessions, getSession } from './service';
import { saveProfile } from '../../settings/profile';
import {
	saveSessionFixture as saveSession,
	saveLegacyBigramRowsFixture
} from '../../test-utils/fixtures';
import type { StoredSession, BigramAggregate, DiagnosticReport } from '../core/types';

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

/** A current row: the text plus its keystroke stream, and nothing derived. */
function makeSession(overrides: Partial<StoredSession> = {}): StoredSession {
	return {
		id: 's1',
		timestamp: 1_000,
		type: 'bigram-drill',
		durationMs: 300_000,
		wpm: 68,
		errorRate: 0.03,
		bigramsTargeted: ['th'],
		text: 'the',
		stream: {
			positions: Int16Array.from([0, 1, 1]),
			times: Uint32Array.from([0, 120, 110]),
			typed: 'the'
		},
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

	it('keeps the keystroke stream typed across a round-trip', async () => {
		// The whole storage model rests on structured clone preserving typed
		// arrays — a stream that came back as a plain object would decode to
		// garbage rather than fail loudly.
		await saveSession(makeSession());

		const stream = (await getSession('s1'))?.stream;
		expect(stream?.positions).toBeInstanceOf(Int16Array);
		expect(stream?.times).toBeInstanceOf(Uint32Array);
		expect(Array.from(stream!.positions)).toEqual([0, 1, 1]);
		expect(Array.from(stream!.times)).toEqual([0, 120, 110]);
		expect(stream?.typed).toBe('the');
	});

	it('writes no bigram rows — aggregates are derived, not stored', async () => {
		await saveSession(makeSession());
		expect(await getBigramHistory('th')).toEqual([]);
	});

	it('returns undefined for unknown sessions', async () => {
		expect(await getSession('does-not-exist')).toBeUndefined();
	});

	it('lists recent sessions newest-first', async () => {
		await saveSession(makeSession({ id: 'a', timestamp: 1_000 }));
		await saveSession(makeSession({ id: 'b', timestamp: 3_000 }));
		await saveSession(makeSession({ id: 'c', timestamp: 2_000 }));

		const recent = await getRecentSessions();
		expect(recent.map((s) => s.id)).toEqual(['b', 'c', 'a']);
	});

	it('reads legacy bigram rows newest-first', async () => {
		// Pre-stream history the graduation filter still consults.
		await saveLegacyBigramRowsFixture([
			makeAggregate({ bigram: 'th', sessionId: 's1', meanTime: 140 }),
			makeAggregate({ bigram: 'er', sessionId: 's1', meanTime: 180 }),
			makeAggregate({ bigram: 'th', sessionId: 's2', meanTime: 130 })
		]);

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
		await saveLegacyBigramRowsFixture([makeAggregate()]);
		await saveProfile({ language: 'en' });

		await clearAll();

		expect(await getSession('s1')).toBeUndefined();
		expect(await getBigramHistory('th')).toEqual([]);
	});
});
