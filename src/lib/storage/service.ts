import { db, bigramRecordKey, SINGLETON_ID } from './db';
import type { SessionSummary } from '../session/types';
import type { BigramAggregate } from '../bigram/types';
import type { DiagnosticRawData } from '../diagnostic/types';
import type { UserSettings } from '../models';
import type { ProgressStore } from '../progress/types';

/**
 * Persist summary + mirrored bigram rows (+ optional raw data for diagnostics)
 * atomically — a partial write would desync `sessions` and `bigramRecords`.
 * Pass `rawData` for diagnostic sessions only; drill sessions discard theirs.
 */
export async function saveSession(
	summary: SessionSummary,
	rawData?: DiagnosticRawData
): Promise<void> {
	await db.transaction('rw', db.sessions, db.bigramRecords, db.diagnosticRawData, async () => {
		await db.sessions.put(summary);

		const rows = summary.bigramAggregates.map((agg) => ({
			...agg,
			key: bigramRecordKey(agg.bigram, agg.sessionId)
		}));
		if (rows.length > 0) {
			await db.bigramRecords.bulkPut(rows);
		}

		if (rawData) {
			await db.diagnosticRawData.put(rawData);
		}
	});
}

export async function getSession(id: string): Promise<SessionSummary | undefined> {
	return db.sessions.get(id);
}

/** Newest first. Backed by the `timestamp` index. */
export async function getRecentSessions(limit: number): Promise<SessionSummary[]> {
	return db.sessions.orderBy('timestamp').reverse().limit(limit).toArray();
}

/** All aggregates for one bigram, newest first. Powers sparklines (spec §10.6). */
export async function getBigramHistory(bigram: string): Promise<BigramAggregate[]> {
	const rows = await db.bigramRecords.where('bigram').equals(bigram).toArray();
	return rows
		.map(({ key, ...rest }) => rest)
		.sort((a, b) => b.sessionId.localeCompare(a.sessionId));
}

export async function getDiagnosticRawData(
	sessionId: string
): Promise<DiagnosticRawData | undefined> {
	return db.diagnosticRawData.get(sessionId);
}

/** `undefined` before first save (pre-onboarding). */
export async function getProfile(): Promise<UserSettings | undefined> {
	const record = await db.profile.get(SINGLETON_ID);
	return record?.settings;
}

export async function saveProfile(settings: UserSettings): Promise<void> {
	await db.profile.put({ id: SINGLETON_ID, settings });
}

export async function getProgressStore(): Promise<ProgressStore | undefined> {
	const record = await db.progressStore.get(SINGLETON_ID);
	return record?.store;
}

export async function saveProgressStore(store: ProgressStore): Promise<void> {
	await db.progressStore.put({ id: SINGLETON_ID, store });
}

/** Wipe all persisted data — used by "reset" and by the test suite. */
export async function clearAll(): Promise<void> {
	// Dexie's positional transaction() overload tops out at 5 tables; pass an
	// array for the 6-table case.
	await db.transaction(
		'rw',
		[db.sessions, db.bigramRecords, db.diagnosticRawData, db.profile, db.progressStore],
		async () => {
			await Promise.all([
				db.sessions.clear(),
				db.bigramRecords.clear(),
				db.diagnosticRawData.clear(),
				db.profile.clear(),
				db.progressStore.clear()
			]);
		}
	);
}
