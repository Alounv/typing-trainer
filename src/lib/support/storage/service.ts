import { db } from './db';
import type { SessionSummary, BigramAggregate } from '../core';

export async function getSession(id: string): Promise<SessionSummary | undefined> {
	return db.sessions.get(id);
}

/** Newest first. Backed by the `timestamp` index. */
export async function getRecentSessions(limit: number): Promise<SessionSummary[]> {
	return db.sessions.orderBy('timestamp').reverse().limit(limit).toArray();
}

/** All aggregates for one bigram, newest first. Powers sparklines. */
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
