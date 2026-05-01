import { db } from './db';
import type { SessionSummary, BigramAggregate } from '../core';

export async function getSession(id: string): Promise<SessionSummary | undefined> {
	return db.sessions.get(id);
}

const STATS_SESSION_CAP = 100;

/** Newest first. Backed by the `timestamp` index. */
export async function getRecentSessions(
	limit: number = STATS_SESSION_CAP
): Promise<SessionSummary[]> {
	return db.sessions.orderBy('timestamp').reverse().limit(limit).toArray();
}

/** Newest-first, diagnostics only. Streams the timestamp index so the cap counts diagnostics. */
export async function getRecentDiagnosticSessions(
	limit: number = STATS_SESSION_CAP
): Promise<SessionSummary[]> {
	return db.sessions
		.orderBy('timestamp')
		.reverse()
		.filter((s) => s.type === 'diagnostic')
		.limit(limit)
		.toArray();
}

/** All aggregates for one bigram, newest first. Powers sparklines. */
export async function getBigramHistory(bigram: string): Promise<BigramAggregate[]> {
	const rows = await db.bigramRecords.where('bigram').equals(bigram).toArray();
	return rows
		.map(({ key, ...rest }) => rest)
		.sort((a, b) => b.sessionId.localeCompare(a.sessionId));
}

/** Every bigram aggregate ever recorded. Unsorted. */
export async function getAllBigramAggregates(): Promise<BigramAggregate[]> {
	const rows = await db.bigramRecords.toArray();
	return rows.map(({ key: _key, ...rest }) => rest);
}

/** Wipe all persisted data — used by "reset" and by the test suite. */
export async function clearAll(): Promise<void> {
	await db.transaction('rw', [db.sessions, db.bigramRecords, db.profile], async () => {
		await Promise.all([db.sessions.clear(), db.bigramRecords.clear(), db.profile.clear()]);
	});
}
