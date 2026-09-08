/**
 * Test-only fixtures.
 *
 * Centralizes the handful of domain-internal calls that tests need to seed
 * state. Production code must not import from this folder — it exists so
 * domains can keep their public surfaces clean while tests still have a
 * blessed path for setup.
 */
import { saveSession as saveSessionInternal } from '../session/persistence';
import { db, bigramRecordKey } from '../support/storage';
import type { BigramAggregate, StoredSession } from '../support/core';

/** Seed a session row into the in-memory IndexedDB. */
export async function saveSessionFixture(session: StoredSession): Promise<void> {
	await saveSessionInternal(session);
}

/**
 * Seed `bigramRecords` directly. Nothing in the app writes that table any more
 * — it holds pre-stream history only — so tests covering the legacy read path
 * have to plant the rows themselves.
 */
export async function saveLegacyBigramRowsFixture(
	aggregates: readonly BigramAggregate[]
): Promise<void> {
	await db.bigramRecords.bulkPut(
		aggregates.map((agg) => ({ ...agg, key: bigramRecordKey(agg.bigram, agg.sessionId) }))
	);
}
