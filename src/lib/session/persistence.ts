/**
 * Session persistence — the single owner of session writes.
 *
 * Lives in `session/` (not `storage/`) so UI and other domain modules
 * have a session-shaped API rather than a generic storage one. The
 * only thing that still reaches directly into `storage/db` is this
 * file — everything above it calls `saveSession` and never sees Dexie.
 */
import { db, bigramRecordKey } from '../storage';
import type { SessionSummary } from './types';

/**
 * Persist summary + mirrored bigram rows atomically — a partial write would
 * desync `sessions` and `bigramRecords`. Diagnostic reports (when present)
 * ride along on the summary itself; there's no separate table.
 */
export async function saveSession(summary: SessionSummary): Promise<void> {
	await db.transaction('rw', db.sessions, db.bigramRecords, async () => {
		await db.sessions.put(summary);

		const rows = summary.bigramAggregates.map((agg) => ({
			...agg,
			key: bigramRecordKey(agg.bigram, agg.sessionId)
		}));
		if (rows.length > 0) {
			await db.bigramRecords.bulkPut(rows);
		}
	});
}
