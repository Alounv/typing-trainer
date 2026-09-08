/**
 * Session persistence — the single owner of session writes.
 *
 * Lives in `session/` (not `storage/`) so UI and other domain modules
 * have a session-shaped API rather than a generic storage one. The
 * only thing that still reaches directly into `storage/db` is this
 * file — everything above it calls `saveSession` and never sees Dexie.
 */
import { db } from '../support/storage';
import type { StoredSession } from '../support/core';

/**
 * Persist one session row: the text, the keystroke stream, and the two scalars
 * list views sort on. Nothing derived is written, so there is no second table
 * to keep in step and no transaction to wrap — `bigramRecords` holds legacy
 * rows only and is deliberately never written again.
 */
export async function saveSession(session: StoredSession): Promise<void> {
	await db.sessions.put(session);
}
