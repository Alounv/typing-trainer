import Dexie, { type EntityTable } from 'dexie';
import type { StoredSession, UserSettings, BigramAggregate } from '../core';

export const SINGLETON_ID = 'default';

interface ProfileRecord {
	id: typeof SINGLETON_ID;
	settings: UserSettings;
}

/**
 * `bigramRecords` is written by nothing and read by nothing — the graduation
 * filter that consulted it is gone. It survives only so that exporting an old
 * database does not silently drop pre-stream history.
 *
 * To change an index, bump `version(n)` with a new `.stores(...)`. Never mutate
 * v1: both the legacy and current row shapes live in its stores.
 */
class TypingTrainerDB extends Dexie {
	sessions!: EntityTable<StoredSession, 'id'>;
	bigramRecords!: EntityTable<BigramAggregate & { key: string }, 'key'>;
	profile!: EntityTable<ProfileRecord, 'id'>;

	constructor() {
		super('typing-trainer');
		this.version(1).stores({
			sessions: 'id, timestamp, type',
			bigramRecords: 'key, bigram, sessionId, classification',
			profile: 'id'
		});
	}
}

/** Shared singleton — opening multiple Dexies on one DB name causes upgrade weirdness. */
export const db = new TypingTrainerDB();
