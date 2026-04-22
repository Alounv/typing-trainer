/**
 * Test-only fixtures.
 *
 * Centralizes the handful of domain-internal calls that tests need to seed
 * state. Production code must not import from this folder — it exists so
 * domains can keep their public surfaces clean while tests still have a
 * blessed path for setup.
 */
import { saveSession as saveSessionInternal } from '../session/persistence';
import type { SessionSummary } from '../support/core';

/** Seed a session + its mirrored bigram rows into the in-memory IndexedDB. */
export async function saveSessionFixture(summary: SessionSummary): Promise<void> {
	await saveSessionInternal(summary);
}
