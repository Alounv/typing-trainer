/**
 * Lives in `settings/` (not `storage/`) so the UI talks to a domain module:
 * schema versioning and validation are domain concerns. Replace-only on
 * import — merging two histories produces unsolvable conflicts (overlapping
 * session IDs, diverging aggregates); the source file on disk is the undo.
 */
import { db, SINGLETON_ID } from '$lib/support/storage';
import type { SessionSummary, BigramAggregate, UserSettings } from '$lib/support/core';

interface ProfileRecord {
	id: typeof SINGLETON_ID;
	settings: UserSettings;
}

/** Bump when the export shape changes. Higher-version files are rejected on import. */
const SCHEMA_VERSION = 1;

const APP_TAG = 'typing-trainer' as const;

type BigramRow = BigramAggregate & { key: string };

/**
 * `bigramRecords` is redundant with `sessions[*].bigramAggregates` but we
 * round-trip it faithfully — keeps export/import symmetric with the DB and
 * tolerates orphan rows without a matching session summary.
 */
export interface ExportFile {
	app: typeof APP_TAG;
	schemaVersion: number;
	exportedAt: number;
	data: {
		sessions: SessionSummary[];
		bigramRecords: BigramRow[];
		profile: ProfileRecord | null;
	};
}

export async function exportAll(): Promise<ExportFile> {
	const [sessions, bigramRecords, profile] = await db.transaction(
		'r',
		[db.sessions, db.bigramRecords, db.profile],
		async () => {
			return Promise.all([
				db.sessions.toArray(),
				db.bigramRecords.toArray(),
				db.profile.get(SINGLETON_ID)
			]);
		}
	);

	return {
		app: APP_TAG,
		schemaVersion: SCHEMA_VERSION,
		exportedAt: Date.now(),
		data: {
			sessions,
			bigramRecords,
			profile: profile ?? null
		}
	};
}

export class ImportValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ImportValidationError';
	}
}

/**
 * All-or-nothing: validation, then a single transaction clears and refills.
 * A mid-write crash leaves the DB empty rather than half-merged — acceptable
 * since the user still has the source file on disk.
 */
export async function importAll(payload: unknown): Promise<void> {
	const file = validate(payload);

	await db.transaction('rw', [db.sessions, db.bigramRecords, db.profile], async () => {
		await Promise.all([db.sessions.clear(), db.bigramRecords.clear(), db.profile.clear()]);

		if (file.data.sessions.length > 0) {
			await db.sessions.bulkPut(file.data.sessions);
		}
		if (file.data.bigramRecords.length > 0) {
			await db.bigramRecords.bulkPut(file.data.bigramRecords);
		}
		if (file.data.profile) {
			await db.profile.put(file.data.profile);
		}
	});
}

/**
 * Structural validation only — catch "wrong file" / "newer build" before we
 * wipe the user's data. The DB tolerates field-level looseness.
 */
function validate(payload: unknown): ExportFile {
	if (!isRecord(payload)) {
		throw new ImportValidationError('Expected a JSON object at the top level.');
	}
	if (payload.app !== APP_TAG) {
		throw new ImportValidationError(
			`Not a typing-trainer export (got app="${String(payload.app)}").`
		);
	}
	if (typeof payload.schemaVersion !== 'number') {
		throw new ImportValidationError('Missing or non-numeric schemaVersion.');
	}
	if (payload.schemaVersion > SCHEMA_VERSION) {
		throw new ImportValidationError(
			`Export was produced by a newer build (schemaVersion=${payload.schemaVersion}, supported ≤${SCHEMA_VERSION}).`
		);
	}
	if (payload.schemaVersion < SCHEMA_VERSION) {
		// When v2 lands, replace this with a migrator dispatch.
		throw new ImportValidationError(
			`Export uses an older schema (v${payload.schemaVersion}) that this build can no longer read.`
		);
	}
	if (!isRecord(payload.data)) {
		throw new ImportValidationError('Missing "data" object.');
	}
	const { sessions, bigramRecords, profile } = payload.data as Record<string, unknown>;
	if (!Array.isArray(sessions)) {
		throw new ImportValidationError('"data.sessions" must be an array.');
	}
	if (!Array.isArray(bigramRecords)) {
		throw new ImportValidationError('"data.bigramRecords" must be an array.');
	}
	if (profile !== null && !isRecord(profile)) {
		throw new ImportValidationError('"data.profile" must be an object or null.');
	}

	// Spot-check required fields without pulling in a full schema dependency.
	for (const s of sessions) {
		if (!isRecord(s) || typeof s.id !== 'string' || typeof s.timestamp !== 'number') {
			throw new ImportValidationError('A session row is missing required fields.');
		}
	}
	for (const b of bigramRecords) {
		if (!isRecord(b) || typeof b.key !== 'string' || typeof b.bigram !== 'string') {
			throw new ImportValidationError('A bigramRecord row is missing required fields.');
		}
	}

	return payload as unknown as ExportFile;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
