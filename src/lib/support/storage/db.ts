import Dexie, { type EntityTable } from 'dexie';
import type { StoredSession, UserSettings, BigramAggregate } from '../core';

/** Fixed primary key for the singleton profile table. */
export const SINGLETON_ID = 'default';

interface ProfileRecord {
	id: typeof SINGLETON_ID;
	settings: UserSettings;
}

/**
 * IndexedDB schema.
 *
 * `sessions` holds two row shapes, distinguished by whether `stream` is set:
 *
 *   legacy  { bigramAggregates }            — conclusions, no evidence
 *   current { text, stream }                — evidence, conclusions derived
 *
 * Current rows carry the raw keystroke log and no aggregates; `storage/service`
 * re-derives those on read. That leaves one source of truth and lets a change
 * to what "clean" means re-score the whole history instead of only future
 * sessions. Legacy rows can never gain context — they never stored their text.
 *
 * `bigramRecords` mirrors the aggregates of legacy rows only. Nothing writes to
 * it any more; it exists so pre-stream history keeps feeding the planner, and
 * goes away with the last legacy row.
 *
 * Diagnostic reports ride along on the session row itself, so there is no
 * separate reports table.
 *
 * Indexes are unchanged by the stream migration — both shapes live in `v1`'s
 * stores. To change an index: bump `version(n)` with a new `.stores(...)` and
 * never mutate v1.
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

/** Dexie needs a scalar primary key, so the `(bigram, sessionId)` pair is pre-joined. */
export function bigramRecordKey(bigram: string, sessionId: string): string {
	return `${bigram}::${sessionId}`;
}

/** Shared singleton — opening multiple Dexies on one DB name causes upgrade weirdness. */
export const db = new TypingTrainerDB();
