import type { KeystrokeEvent } from './types';

/**
 * Keystroke event after correction lookahead. Only the first input at each
 * position appears here — subsequent retypes collapse into the annotations
 * on that first-input event (spec §2.2).
 */
export interface AnnotatedKeystrokeEvent extends KeystrokeEvent {
	/** True if the user retyped a correct character at this position later. */
	corrected: boolean;
	/** Ms between the first input and the correcting retype. 0 if never corrected. */
	correctionDelay: number;
}

/**
 * Collapse raw capture events into first-input-per-position annotated events.
 *
 * - Groups events by `position`, keeps only the earliest per group (the "first
 *   input" that counts for error rate and bigram timing).
 * - If any later event at the same position matches `expected`, marks the
 *   first input as `corrected` and records `correctionDelay` relative to the
 *   earliest correcting retype.
 * - The original raw log is untouched — this is a pure transform.
 *
 * Note: we don't use the 500ms correction window here. It's reserved for the
 * UI-level "treat this backspace as a live correction" cue; for offline
 * analytics we want to credit corrections regardless of how long they took.
 */
export function annotateFirstInputs(
	events: readonly KeystrokeEvent[]
): AnnotatedKeystrokeEvent[] {
	// Bucket by position. Using an array keyed by position (cheap for the
	// expected range — positions are small ints) beats a Map here.
	const buckets = new Map<number, KeystrokeEvent[]>();
	for (const e of events) {
		let bucket = buckets.get(e.position);
		if (!bucket) {
			bucket = [];
			buckets.set(e.position, bucket);
		}
		bucket.push(e);
	}

	const annotated: AnnotatedKeystrokeEvent[] = [];
	for (const [, bucket] of buckets) {
		// Ensure chronological order — capture already emits in order, but
		// explicit sort is cheap insurance against future callers.
		bucket.sort((a, b) => a.timestamp - b.timestamp);
		const first = bucket[0];

		let corrected = false;
		let correctionDelay = 0;
		for (let i = 1; i < bucket.length; i++) {
			const later = bucket[i];
			if (later.actual === first.expected) {
				corrected = true;
				correctionDelay = later.timestamp - first.timestamp;
				break;
			}
		}

		annotated.push({ ...first, corrected, correctionDelay });
	}

	annotated.sort((a, b) => a.position - b.position);
	return annotated;
}
