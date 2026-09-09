import type { BigramAggregate, SessionSummary, StoredSession } from '../support/core';
import type { ClassificationThresholds } from '../support/core';
import { decodeStream } from './stream-codec';
import { annotateFirstInputs } from './postprocess';
import { extractBigramAggregates } from './extraction';

/**
 * Measures a stored row against whatever thresholds are current. Legacy rows
 * come back exactly as stored — with no text there is nothing to re-measure.
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
