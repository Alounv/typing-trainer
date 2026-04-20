import { v4 as uuid } from 'uuid';
import type { KeystrokeEvent } from '../typing/types';
import { annotateFirstInputs } from '../typing/postprocess';
import { extractBigramAggregates } from '../bigram/extraction';
import type { ClassificationThresholds } from '../bigram/classification';
import type { SessionSummary, SessionType } from './types';

/**
 * Inputs for turning a finished capture into a persistable summary.
 * `events` is the raw log (retypes included); this function annotates them
 * before bigram extraction so callers don't have to remember that.
 */
export interface BuildSessionSummaryInput {
	events: readonly KeystrokeEvent[];
	type: SessionType;
	/** Total drill length in characters — needed because `events` only covers what the user actually typed if they aborted. */
	textLength: number;
	/** `performance.now()` relative duration of the session in ms. */
	durationMs: number;
	bigramsTargeted?: string[];
	/** Override the default classification thresholds. */
	thresholds?: ClassificationThresholds;
	/** Injectable for tests; defaults to `uuid()` + `Date.now()`. */
	idGenerator?: () => string;
	timestampProvider?: () => number;
}

/**
 * Pure transform: raw keystroke log → persistable `SessionSummary`. Id and
 * timestamp are the only non-determinism, both injectable for tests.
 * Bigram timings use first-input-only events; raw events are archived separately.
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
 * Raw WPM — smoothing lives in `progress/`. 5 chars = 1 word. Uses `textLength`
 * (not event count) so aborted sessions don't inflate the rate. Returns 0 for
 * zero-duration sessions.
 */
function computeWPM(textLength: number, durationMs: number): number {
	if (durationMs <= 0) return 0;
	const minutes = durationMs / 60_000;
	return textLength / 5 / minutes;
}

/** Fraction of first-input positions where the user typed the wrong char. Retypes don't count. */
function computeErrorRate(annotated: readonly { expected: string; actual: string }[]): number {
	if (annotated.length === 0) return 0;
	let errors = 0;
	for (const e of annotated) if (e.actual !== e.expected) errors++;
	return errors / annotated.length;
}

// SessionRunner: plain TS lifecycle manager for an in-flight session.
// UI wraps getter output in its own reactive state.

export interface SessionRunnerConfig {
	type: SessionType;
	text: string;
	/**
	 * Target bigrams for a drill session. Recorded on the summary for later
	 * analysis (cross-session graduation lives in `practice/graduation-filter`).
	 */
	targetBigrams?: readonly string[];
	/** Injectable so tests get deterministic ids. */
	idGenerator?: () => string;
	/** Injectable so tests get deterministic timestamps for `finalize`. */
	timestampProvider?: () => number;
	/** Override classification thresholds for the final summary. */
	thresholds?: ClassificationThresholds;
}

/**
 * In-flight session manager (pure TS; no timers). UI calls `recordEvent` per
 * keystroke, `isComplete()` when done, and `finalize(elapsedMs)` to persist.
 * The runner doesn't own the clock — tests fast-forward synthetic time freely.
 * Sessions run until the text is fully typed; there's no in-session early-out.
 */
export class SessionRunner {
	private readonly config: SessionRunnerConfig;
	private readonly events_: KeystrokeEvent[] = [];
	private position_ = 0;

	constructor(config: SessionRunnerConfig) {
		this.config = config;
	}

	/** Record a keystroke. Appends to the log and advances position. */
	recordEvent(event: KeystrokeEvent): void {
		this.events_.push(event);
		// `Math.max` defends against out-of-order events; position only moves forward.
		this.position_ = Math.max(this.position_, event.position + 1);
	}

	/** True once every position in the text has been typed. */
	isComplete(): boolean {
		return this.position_ >= this.config.text.length;
	}

	/** Produce a persistable summary from the accumulated events. */
	finalize(elapsedMs: number): SessionSummary {
		return buildSessionSummary({
			events: this.events_,
			type: this.config.type,
			textLength: this.config.text.length,
			durationMs: elapsedMs,
			bigramsTargeted: this.config.targetBigrams ? [...this.config.targetBigrams] : undefined,
			thresholds: this.config.thresholds,
			idGenerator: this.config.idGenerator,
			timestampProvider: this.config.timestampProvider
		});
	}

	/** Snapshot of events captured so far. Callers should treat as read-only. */
	get events(): readonly KeystrokeEvent[] {
		return this.events_;
	}

	/** Current cursor position (index of the next char to type). */
	get position(): number {
		return this.position_;
	}
}
