import Dexie, { type EntityTable } from 'dexie';
import type { StoredSession, UserSettings } from '../core';

export const SINGLETON_ID = 'default';

interface ProfileRecord {
	id: typeof SINGLETON_ID;
	settings: UserSettings;
}

/**
 * To change an index, bump `version(n)` with a new `.stores(...)`. Never mutate
 * an existing version — Dexie replays them in order on any database that has
 * not seen them yet, so v1 still has to describe the shape v1 wrote.
 */
class TypingTrainerDB extends Dexie {
	sessions!: EntityTable<StoredSession, 'id'>;
	profile!: EntityTable<ProfileRecord, 'id'>;

	constructor() {
		super('typing-trainer');
		this.version(1).stores({
			sessions: 'id, timestamp, type',
			bigramRecords: 'key, bigram, sessionId, classification',
			profile: 'id'
		});
		// Pre-stream rows stored aggregates instead of keystrokes, so nothing can
		// re-measure them against current thresholds. Deleted rather than kept as
		// rows every reader would have to special-case; `bigramRecords` mirrored
		// those rows only, so it goes with them.
		this.version(2)
			.stores({ sessions: 'id, timestamp', bigramRecords: null })
			.upgrade((tx) =>
				tx
					.table<Partial<StoredSession>>('sessions')
					.filter((row) => !row.stream)
					.delete()
			);
	}
}

/** Shared singleton — opening multiple Dexies on one DB name causes upgrade weirdness. */
export const db = new TypingTrainerDB();
