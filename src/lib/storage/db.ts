import Dexie, { type EntityTable } from 'dexie';
import type { SessionSummary } from '../session/types';
import type { BigramAggregate } from '../bigram/types';
import type { DiagnosticRawData } from '../diagnostic/types';
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
 * scan every session. `diagnosticRawData` is split off because it's heavy
 * and only needed when replaying classification thresholds.
 *
 * To migrate: bump `version(n)` with a new `.stores(...)` — never mutate v1.
 */
export class TypingTrainerDB extends Dexie {
	sessions!: EntityTable<SessionSummary, 'id'>;
	bigramRecords!: EntityTable<BigramAggregate & { key: string }, 'key'>;
	diagnosticRawData!: EntityTable<DiagnosticRawData, 'sessionId'>;
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
	}
}

/** Dexie needs a scalar primary key, so the `(bigram, sessionId)` pair is pre-joined. */
export function bigramRecordKey(bigram: string, sessionId: string): string {
	return `${bigram}::${sessionId}`;
}

/** Shared singleton — opening multiple Dexies on one DB name causes upgrade weirdness. */
export const db = new TypingTrainerDB();
