/**
 * Lives in `settings/` (not `storage/`) so the UI talks to a domain module:
 * schema versioning and validation are domain concerns. Replace-only on
 * import — merging two histories produces unsolvable conflicts (overlapping
 * session IDs, diverging aggregates); the source file on disk is the undo.
 */
import { db, SINGLETON_ID } from '$lib/support/storage';
import type { StoredSession, KeystrokeStream, UserSettings } from '$lib/support/core';

interface ProfileRecord {
	id: typeof SINGLETON_ID;
	settings: UserSettings;
}

/**
 * Bump when the export shape changes. Higher-version files are rejected on
 * import; older ones are migrated where the data still makes sense.
 *
 *   v1 — sessions carried bigram aggregates and no keystrokes.
 *   v2 — sessions carry `text` + `stream`; aggregates are derived on read.
 *   v3 — pre-stream sessions and the `bigramRecords` table are gone.
 *
 * v1 and v2 files still import. Their pre-stream rows are skipped rather than
 * rejecting the whole file, so an old export stays usable as a restore point —
 * a v1 file is just one where every row is skipped.
 */
const SCHEMA_VERSION = 3;

const APP_TAG = 'typing-trainer' as const;

/**
 * JSON has no typed arrays, so the stream's numeric columns travel as plain
 * arrays. Base64 would be the same size once encoded and would drag platform
 * endianness into a file meant to outlive the machine that wrote it; plain
 * arrays are portable, inspectable, and compress well (`positions` is a run of
 * ones).
 */
interface SerializedStream {
	positions: number[];
	times: number[];
	typed: string;
}

/** `stream` is absent on rows from a v1/v2 file, which is what marks them skippable. */
type ExportedSession = Omit<StoredSession, 'stream'> & { stream?: SerializedStream };

type ImportableSession = ExportedSession & { stream: SerializedStream };

export interface ExportFile {
	app: typeof APP_TAG;
	schemaVersion: number;
	exportedAt: number;
	data: {
		sessions: ExportedSession[];
		profile: ProfileRecord | null;
	};
}

export async function exportAll(): Promise<ExportFile> {
	const [sessions, profile] = await db.transaction('r', [db.sessions, db.profile], async () => {
		return Promise.all([db.sessions.toArray(), db.profile.get(SINGLETON_ID)]);
	});

	return {
		app: APP_TAG,
		schemaVersion: SCHEMA_VERSION,
		exportedAt: Date.now(),
		data: {
			sessions: sessions.map(serializeSession),
			profile: profile ?? null
		}
	};
}

function serializeSession({ stream, ...rest }: StoredSession): ExportedSession {
	return {
		...rest,
		stream: {
			positions: Array.from(stream.positions),
			times: Array.from(stream.times),
			typed: stream.typed
		}
	};
}

function toKeystrokeStream(stream: SerializedStream): KeystrokeStream {
	return {
		positions: Int16Array.from(stream.positions),
		times: Uint32Array.from(stream.times),
		typed: stream.typed
	};
}

export class ImportValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ImportValidationError';
	}
}

/**
 * What an import will actually land. The modal previews this before the wipe,
 * and `importAll` keeps exactly the same rows — one definition of "pre-stream"
 * for both. Tolerates a half-checked payload, since the preview runs before
 * {@link importAll} validates.
 */
export function summarizeImport(payload: ExportFile): {
	sessions: number;
	skipped: number;
	hasProfile: boolean;
} {
	const rows = Array.isArray(payload.data?.sessions) ? payload.data.sessions : [];
	const importable = rows.filter(hasStream).length;
	return {
		sessions: importable,
		skipped: rows.length - importable,
		hasProfile: payload.data?.profile != null
	};
}

function hasStream(session: ExportedSession): session is ImportableSession {
	return session.stream !== undefined;
}

/**
 * All-or-nothing: validation, then a single transaction clears and refills.
 * A mid-write crash leaves the DB empty rather than half-merged — acceptable
 * since the user still has the source file on disk.
 */
export async function importAll(payload: unknown): Promise<void> {
	const file = validate(payload);
	const sessions = file.data.sessions.filter(hasStream);

	await db.transaction('rw', [db.sessions, db.profile], async () => {
		await Promise.all([db.sessions.clear(), db.profile.clear()]);

		if (sessions.length > 0) {
			await db.sessions.bulkPut(sessions.map(deserializeSession));
		}
		if (file.data.profile) {
			await db.profile.put(file.data.profile);
		}
	});
}

// Field by field rather than a spread: a v1/v2 row carries `type` and
// `bigramAggregates`, which this build has no meaning for and would otherwise
// persist untouched.
function deserializeSession(session: ImportableSession): StoredSession {
	return {
		id: session.id,
		timestamp: session.timestamp,
		durationMs: session.durationMs,
		wpm: session.wpm,
		errorRate: session.errorRate,
		text: session.text,
		language: session.language,
		stream: toKeystrokeStream(session.stream)
	};
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
	// v1 and v2 need no migration: a row either carries a stream or is skipped,
	// and that is the only difference between them here. Anything older than v1
	// never shipped.
	if (payload.schemaVersion < 1) {
		throw new ImportValidationError(
			`Export uses an older schema (v${payload.schemaVersion}) that this build can no longer read.`
		);
	}
	if (!isRecord(payload.data)) {
		throw new ImportValidationError('Missing "data" object.');
	}
	const { sessions, profile } = payload.data as Record<string, unknown>;
	if (!Array.isArray(sessions)) {
		throw new ImportValidationError('"data.sessions" must be an array.');
	}
	if (profile !== null && profile !== undefined && !isRecord(profile)) {
		throw new ImportValidationError('"data.profile" must be an object or null.');
	}

	// Spot-check required fields without pulling in a full schema dependency.
	for (const s of sessions) {
		if (!isRecord(s) || typeof s.id !== 'string' || typeof s.timestamp !== 'number') {
			throw new ImportValidationError('A session row is missing required fields.');
		}
		if (s.stream !== undefined) validateStream(s.stream, s.id);
	}

	return payload as unknown as ExportFile;
}

/**
 * A stream whose columns disagree would throw deep inside the codec on read,
 * long after the import wiped the previous data. Catch it here instead.
 */
function validateStream(stream: unknown, sessionId: string): void {
	if (!isRecord(stream)) {
		throw new ImportValidationError(`Session ${sessionId} has a malformed keystroke stream.`);
	}
	const { positions, times, typed } = stream;
	if (!Array.isArray(positions) || !Array.isArray(times) || typeof typed !== 'string') {
		throw new ImportValidationError(`Session ${sessionId} has a malformed keystroke stream.`);
	}
	if (positions.length !== times.length || positions.length !== Array.from(typed).length) {
		throw new ImportValidationError(
			`Session ${sessionId} has a keystroke stream whose columns disagree ` +
				`(${positions.length} positions, ${times.length} times, ${Array.from(typed).length} characters).`
		);
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
