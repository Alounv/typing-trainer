import type { Passage } from '../corpus';
import type { SessionSummary } from '../support/core';
import { PACING_TARGET_ERROR_RATE } from '../support/core';
import { decodeStream } from './stream-codec';
import { annotateFirstInputs, type AnnotatedKeystrokeEvent } from './postprocess';

export interface GhostRun {
	/** Where in the current passage this run paces, as a half-open span. */
	start: number;
	end: number;
	/**
	 * Ms since the span's first character, one entry per character in it. Entry
	 * 0 is therefore always 0: both runs are level on the keystroke that starts
	 * the race, so a slow earlier quote is not carried into this one.
	 */
	times: readonly number[];
}

/** Rows as stored: a ghost is read off raw keystrokes, never off aggregates. */
type GhostSource = Pick<SessionSummary, 'text' | 'stream'>;

/**
 * The typist's own fastest run of each quote in `passage`, ready to replay
 * beside them. Quotes they have never typed get no run — there is nothing
 * honest to pace them against, and a stand-in pace would be someone's
 * prescription rather than their own history.
 *
 * `history` is whatever window the caller already holds, so the "personal
 * best" is the best in that window rather than all-time. Widening it means
 * decoding every stored stream, which is the one read this feature does not
 * justify.
 */
export function findGhostRuns(passage: Passage, history: readonly GhostSource[]): GhostRun[] {
	const firstInputsByRow = new Map<GhostSource, readonly AnnotatedKeystrokeEvent[]>();
	function firstInputs(row: GhostSource): readonly AnnotatedKeystrokeEvent[] {
		let events = firstInputsByRow.get(row);
		if (!events) {
			events = annotateFirstInputs(decodeStream(row.stream!, row.text!));
			firstInputsByRow.set(row, events);
		}
		return events;
	}

	const runs: GhostRun[] = [];
	for (const span of passage.quotes) {
		const quote = passage.text.slice(span.start, span.end);
		let best: GhostRun | null = null;

		for (const row of history) {
			if (!row.text || !row.stream) continue;
			const at = row.text.indexOf(quote);
			if (at < 0) continue;

			const times = paceOf(firstInputs(row), at, quote.length);
			if (!times) continue;
			if (!best || times[times.length - 1] < best.times[best.times.length - 1]) {
				best = { start: span.start, end: span.end, times };
			}
		}

		if (best) runs.push(best);
	}
	return runs;
}

/**
 * Relative arrival times across one span of a past run, or `null` when that run
 * is not a best worth chasing.
 *
 * Errors are held to the same 5% ceiling the pacing verdict uses: a run that
 * broke it was too fast for its typist, and replaying it would set them chasing
 * a pace the app would then tell them off for keeping.
 */
function paceOf(
	events: readonly AnnotatedKeystrokeEvent[],
	at: number,
	length: number
): number[] | null {
	const inSpan = events.filter((e) => e.position >= at && e.position < at + length);
	// One entry per position *touched*, so a short slice means the run stopped
	// part-way through the quote and never paced the rest of it.
	if (inSpan.length !== length) return null;

	let errors = 0;
	for (const e of inSpan) if (e.actual !== e.expected) errors++;
	if (errors / length > PACING_TARGET_ERROR_RATE) return null;

	const start = inSpan[0].timestamp;
	const times = inSpan.map((e) => e.timestamp - start);
	if (times[times.length - 1] <= 0) return null;
	return times;
}
