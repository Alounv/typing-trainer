/**
 * Data-transfer domain — owns full-database export / import.
 *
 * Why this lives in `settings/` (not `storage/`):
 * - The UI calls into this module, and we want a single rule for the
 *   UI: talk to a domain module, never to `storage/*` directly.
 * - Schema versioning + payload validation are domain concerns — the
 *   storage layer only cares about getting bytes in and out of IndexedDB.
 *
 * Replace-only semantics (no merge) are intentional: merging two
 * independent histories produces conflicts (overlapping session IDs,
 * diverging bigram aggregates) we have no principled answer for, and the
 * source file on disk is the user's undo. See `importAll` for the
 * transaction shape.
 */
import { db, SINGLETON_ID, type ProfileRecord } from '$lib/storage/db';
import type { SessionSummary } from '$lib/session/types';
import type { BigramAggregate } from '$lib/bigram/types';

/**
 * Bump when the export shape changes. Old files with a lower version should be
 * migrated forward (not yet implemented — v1 is the only version); files with
 * a higher version are rejected because this build doesn't know how to read them.
 */
export const SCHEMA_VERSION = 1;

/** Identifier stamped into every export so we can detect "wrong app" files early. */
export const APP_TAG = 'typing-trainer' as const;

type BigramRow = BigramAggregate & { key: string };

/**
 * Wire format for a full-database export.
 *
 * `bigramRecords` is redundant with `sessions[*].bigramAggregates`, but we round-trip
 * it faithfully rather than re-deriving — keeps export/import symmetric with the DB,
 * and tolerates any historic rows that might not have a matching session summary.
 */
export interface ExportFile {
	app: typeof APP_TAG;
	schemaVersion: number;
	exportedAt: number;
	data: {
		sessions: SessionSummary[];
		bigramRecords: BigramRow[];
		/** `null` when the user hasn't completed onboarding yet. */
		profile: ProfileRecord | null;
	};
}

/** Read every table into a plain JSON-serializable object. */
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

/** Thrown for any unreadable / unsupported / malformed export payload. */
export class ImportValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ImportValidationError';
	}
}

/**
 * Replace every table with the contents of `payload`. All-or-nothing: validation
 * runs first, then a single transaction clears and refills. A mid-write crash
 * leaves the DB empty rather than half-merged — acceptable because the user still
 * has the source file on disk.
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
 * Structural validation only — we don't deep-check every `BigramAggregate` field,
 * since the DB itself is fairly forgiving. The goal is to catch "this isn't our
 * file" / "this is from a newer build" before we wipe the user's data.
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
		// No migrations exist yet — when we add v2, replace this with a migrator dispatch.
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

	// Spot-check a couple of required fields on each row — cheap, and catches
	// accidentally-edited files without forcing a full schema dependency here.
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
