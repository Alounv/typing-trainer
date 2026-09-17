import type { ClassificationThresholds, SessionSummary, StoredSession } from '../support/core';
import { decodeStream } from './stream-codec';
import { annotateFirstInputs } from './postprocess';
import { extractBigramAggregates } from './extraction';

/** Measures a stored row against whatever thresholds are current. */
export function hydrateSession(
	row: StoredSession,
	thresholds?: ClassificationThresholds
): SessionSummary {
	const events = annotateFirstInputs(decodeStream(row.stream, row.text));
	return { ...row, bigramAggregates: extractBigramAggregates(events, row.id, thresholds) };
}

export function hydrateSessions(
	rows: readonly StoredSession[],
	thresholds?: ClassificationThresholds
): SessionSummary[] {
	return rows.map((row) => hydrateSession(row, thresholds));
}
