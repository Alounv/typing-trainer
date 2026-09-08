import type { BigramAggregate, SessionSummary, StoredSession } from '../support/core';
import type { ClassificationThresholds } from '../support/core';
import { decodeStream } from './stream-codec';
import { annotateFirstInputs } from './postprocess';
import { extractBigramAggregates } from './extraction';

/**
 * Stored row → the session shape the rest of the app reads.
 *
 * Rows written from the stream era on carry the keystroke log and no
 * aggregates, so their bigram statistics are measured here, on read, against
 * whatever thresholds are current. That is the point of storing evidence:
 * changing what "clean" means re-scores every session ever typed, not just
 * the next one.
 *
 * Legacy rows are returned as they were stored — aggregates with their
 * session-time classifications frozen in. They have no text, so there is
 * nothing to re-measure them from.
 */
export function hydrateSession(
	row: StoredSession,
	thresholds?: ClassificationThresholds
): SessionSummary {
	return { ...row, bigramAggregates: deriveAggregates(row, thresholds) };
}

export function hydrateSessions(
	rows: readonly StoredSession[],
	thresholds?: ClassificationThresholds
): SessionSummary[] {
	return rows.map((row) => hydrateSession(row, thresholds));
}

function deriveAggregates(
	row: StoredSession,
	thresholds?: ClassificationThresholds
): BigramAggregate[] {
	if (!row.stream || row.text === undefined) return row.bigramAggregates ?? [];
	const events = decodeStream(row.stream, row.text);
	return extractBigramAggregates(annotateFirstInputs(events), row.id, thresholds);
}
