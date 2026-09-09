// `fake-indexeddb/auto` must come before any import that touches Dexie —
// Dexie opens its connection at module-load time, and we want it to bind
// against the in-memory shim rather than a real IndexedDB.
import 'fake-indexeddb/auto';

import { beforeEach, describe, expect, it } from 'vitest';
import { clearAll, getRecentSessions, getSession } from './service';
import { saveProfile } from '../../settings/profile';
import { saveSession } from '../../session/persistence';
import type { StoredSession } from '../core/types';

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

	it('clearAll wipes every table', async () => {
		await saveSession(makeSession());
		await saveProfile({ language: 'en' });

		await clearAll();

		expect(await getSession('s1')).toBeUndefined();
		expect(await getRecentSessions()).toEqual([]);
	});
});
