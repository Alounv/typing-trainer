import { v4 as uuid } from 'uuid';
import { annotateFirstInputs, encodeStream } from '../skill';
import type { KeystrokeEvent, StoredSession } from '../support/core';

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

/** Injectable non-determinism. Both default to real ones; tests pass their own. */
interface SessionRunnerClock {
	idGenerator?: () => string;
	timestampProvider?: () => number;
}

/**
 * In-flight session manager (pure TS; no timers). UI calls `recordEvent` per
 * keystroke, `isComplete()` when done, and `finalize(elapsedMs)` to persist.
 * The runner doesn't own the clock — tests fast-forward synthetic time freely.
 * Sessions run until the text is fully typed; there's no in-session early-out.
 */
export class SessionRunner {
	private readonly events_: KeystrokeEvent[] = [];
	private position_ = 0;

	constructor(
		private readonly text: string,
		private readonly clock: SessionRunnerClock = {}
	) {}

	recordEvent(event: KeystrokeEvent): void {
		this.events_.push(event);
		// Math.max guards against out-of-order events; position only moves forward.
		this.position_ = Math.max(this.position_, event.position + 1);
	}

	isComplete(): boolean {
		return this.position_ >= this.text.length;
	}

	/**
	 * Raw keystroke log → persistable row. Id and timestamp are the only
	 * non-determinism.
	 *
	 * No bigram aggregates: the row carries the text and the encoded keystroke
	 * stream, and `skill/hydrate` measures bigrams from those on read. `wpm` and
	 * `errorRate` are kept as stored scalars only because every list view sorts
	 * and charts on them — everything else is derived.
	 */
	finalize(elapsedMs: number): StoredSession {
		return {
			id: (this.clock.idGenerator ?? uuid)(),
			timestamp: (this.clock.timestampProvider ?? Date.now)(),
			type: 'real-text',
			durationMs: elapsedMs,
			wpm: computeWPM(this.text.length, elapsedMs),
			errorRate: computeErrorRate(annotateFirstInputs(this.events_)),
			text: this.text,
			stream: encodeStream(this.events_)
		};
	}

	get position(): number {
		return this.position_;
	}
}
