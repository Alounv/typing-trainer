import Dexie, { type EntityTable } from 'dexie';
import type { SessionSummary } from '../session/types';
import type { BigramAggregate } from '../bigram/types';
import type { UserSettings } from '../models';
import type { ProgressStore } from '../progress/types';

/** Fixed primary key for singleton tables (profile, progressStore). */
export const SINGLETON_ID = 'default';

export interface ProfileRecord {
	id: typeof SINGLETON_ID;
	settings: UserSettings;
}

export interface ProgressStoreRecord {
	id: typeof SINGLETON_ID;
	store: ProgressStore;
}

/**
 * IndexedDB schema.
 *
 * `bigramRecords` duplicates data from `SessionSummary.bigramAggregates` —
 * the redundancy is worth it so per-bigram history queries don't have to
 * scan every session. Diagnostic reports ride along on the `SessionSummary`
 * itself (attached at save time), so there's no separate reports table.
 *
 * v2 drops the `diagnosticRawData` table — priority targets are now computed
 * once at save time and persisted on the summary, so the raw event log is
 * no longer load-bearing. Orphaned rows from v1 are abandoned; any existing
 * diagnostic without a persisted report triggers a fresh diagnostic via the
 * planner's `missing-report-diagnostic` branch.
 *
 * To migrate further: bump `version(n)` with a new `.stores(...)` — never
 * mutate an existing version.
 */
export class TypingTrainerDB extends Dexie {
	sessions!: EntityTable<SessionSummary, 'id'>;
	bigramRecords!: EntityTable<BigramAggregate & { key: string }, 'key'>;
	profile!: EntityTable<ProfileRecord, 'id'>;
	progressStore!: EntityTable<ProgressStoreRecord, 'id'>;

	constructor() {
		super('typing-trainer');
		this.version(1).stores({
			sessions: 'id, timestamp, type',
			bigramRecords: 'key, bigram, sessionId, classification',
			diagnosticRawData: 'sessionId',
			profile: 'id',
			progressStore: 'id'
		});
		// v2: drop diagnosticRawData. Passing `null` to `.stores()` removes the table.
		this.version(2).stores({
			diagnosticRawData: null
		});
	}
}

/** Dexie needs a scalar primary key, so the `(bigram, sessionId)` pair is pre-joined. */
export function bigramRecordKey(bigram: string, sessionId: string): string {
	return `${bigram}::${sessionId}`;
}

/** Shared singleton — opening multiple Dexies on one DB name causes upgrade weirdness. */
export const db = new TypingTrainerDB();
