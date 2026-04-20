import Dexie, { type EntityTable } from 'dexie';
import type { SessionSummary } from '../session';
import type { BigramAggregate } from '../bigram';
import type { UserSettings } from '../settings';

/** Fixed primary key for the singleton profile table. */
export const SINGLETON_ID = 'default';

export interface ProfileRecord {
	id: typeof SINGLETON_ID;
	settings: UserSettings;
}

/**
 * IndexedDB schema.
 *
 * `bigramRecords` duplicates data from `SessionSummary.bigramAggregates` —
 * the redundancy is worth it so per-bigram history queries don't have to
 * scan every session. Diagnostic reports ride along on the `SessionSummary`
 * itself (attached at save time), so there's no separate reports table.
 *
 * To migrate: bump `version(n)` with a new `.stores(...)` — never mutate v1.
 */
export class TypingTrainerDB extends Dexie {
	sessions!: EntityTable<SessionSummary, 'id'>;
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

/** Dexie needs a scalar primary key, so the `(bigram, sessionId)` pair is pre-joined. */
export function bigramRecordKey(bigram: string, sessionId: string): string {
	return `${bigram}::${sessionId}`;
}

/** Shared singleton — opening multiple Dexies on one DB name causes upgrade weirdness. */
export const db = new TypingTrainerDB();
