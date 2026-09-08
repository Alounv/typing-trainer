import { db } from './db';
import type { StoredSession, BigramAggregate } from '../core';

/**
 * Raw row readers. Everything here returns {@link StoredSession} — evidence as
 * persisted, with no bigram statistics attached. Callers run rows through
 * `skill`'s `hydrateSession` to get measurements, which is what makes a
 * threshold change re-score history rather than only future sessions. The type
 * split is deliberate: a caller that forgets to hydrate fails to compile.
 */
export async function getSession(id: string): Promise<StoredSession | undefined> {
	return db.sessions.get(id);
}

const STATS_SESSION_CAP = 100;

/** Newest first. Backed by the `timestamp` index. */
export async function getRecentSessions(
	limit: number = STATS_SESSION_CAP
): Promise<StoredSession[]> {
	return db.sessions.orderBy('timestamp').reverse().limit(limit).toArray();
}

/** Newest-first, diagnostics only. Streams the timestamp index so the cap counts diagnostics. */
export async function getRecentDiagnosticSessions(
	limit: number = STATS_SESSION_CAP
): Promise<StoredSession[]> {
	return db.sessions
		.orderBy('timestamp')
		.reverse()
		.filter((s) => s.type === 'diagnostic')
		.limit(limit)
		.toArray();
}

/**
 * All aggregates for one bigram, newest first — legacy rows only, since nothing
 * writes `bigramRecords` any more. Kept so pre-stream history keeps feeding the
 * graduation filter; returns nothing once the last legacy row is gone.
 */
export async function getBigramHistory(bigram: string): Promise<BigramAggregate[]> {
	const rows = await db.bigramRecords.where('bigram').equals(bigram).toArray();
	return rows
		.map(({ key, ...rest }) => rest)
		.sort((a, b) => b.sessionId.localeCompare(a.sessionId));
}

/** Wipe all persisted data — used by "reset" and by the test suite. */
export async function clearAll(): Promise<void> {
	await db.transaction('rw', [db.sessions, db.bigramRecords, db.profile], async () => {
		await Promise.all([db.sessions.clear(), db.bigramRecords.clear(), db.profile.clear()]);
	});
}
