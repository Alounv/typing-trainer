import { v4 as uuid } from 'uuid';
import type { KeystrokeEvent } from '../typing/types';
import { annotateFirstInputs } from '../typing/postprocess';
import { extractBigramAggregates } from '../bigram/extraction';
import type { ClassificationThresholds } from '../bigram/classification';
import type { SessionSummary, SessionType } from './types';

/**
 * Inputs needed to turn a finished capture into a persistable summary.
 *
 * `events` is the raw log straight from `keystrokeCapture` — retypes and all.
 * The runner is responsible for collapsing them via `annotateFirstInputs`
 * before feeding the bigram extractor; upstream callers shouldn't have to
 * remember that invariant.
 */
export interface BuildSessionSummaryInput {
	events: readonly KeystrokeEvent[];
	type: SessionType;
	/** Total drill length in characters — needed because `events` only covers what the user actually typed if they aborted. */
	textLength: number;
	/** `performance.now()` relative duration of the session in ms. */
	durationMs: number;
	bigramsTargeted?: string[];
	/** Override the default classification thresholds (spec §3.1). */
	thresholds?: ClassificationThresholds;
	/** Injectable for tests; defaults to `uuid()` + `Date.now()`. */
	idGenerator?: () => string;
	timestampProvider?: () => number;
}

/**
 * Pure transform: raw keystroke log → persistable `SessionSummary`.
 *
 * No Svelte, no IO. The only non-determinism is the session id and timestamp,
 * both injectable for tests. Caller decides whether to persist the result.
 *
 * Bigram timings use the annotated (first-input-only) events so retypes never
 * inflate the occurrence count; raw events are still what upstream would
 * archive for a diagnostic session.
 */
export function buildSessionSummary(input: BuildSessionSummaryInput): SessionSummary {
	const id = (input.idGenerator ?? uuid)();
	const timestamp = (input.timestampProvider ?? Date.now)();
	const annotated = annotateFirstInputs(input.events);
	const bigramAggregates = extractBigramAggregates(annotated, id, input.thresholds);

	return {
		id,
		timestamp,
		type: input.type,
		durationMs: input.durationMs,
		wpm: computeWPM(input.textLength, input.durationMs),
		errorRate: computeErrorRate(annotated),
		bigramsTargeted: input.bigramsTargeted,
		bigramAggregates
	};
}

/**
 * Raw WPM — never smoothed (smoothing lives in `progress/`). Spec convention:
 * 5 characters = 1 word. Uses `textLength` rather than typed-event count so
 * aborted sessions don't inflate the rate.
 *
 * Returns 0 for a zero-duration session — caller decides whether that's a
 * meaningful save or a discard.
 */
function computeWPM(textLength: number, durationMs: number): number {
	if (durationMs <= 0) return 0;
	const minutes = durationMs / 60_000;
	return textLength / 5 / minutes;
}

/**
 * Fraction of first-input positions where the user typed the wrong char.
 * Retypes don't count — the first input sticks (spec §2.2). 0 for an empty
 * event log.
 */
function computeErrorRate(annotated: readonly { expected: string; actual: string }[]): number {
	if (annotated.length === 0) return 0;
	let errors = 0;
	for (const e of annotated) if (e.actual !== e.expected) errors++;
	return errors / annotated.length;
}
