import type { KeystrokeEvent } from '../core';

/**
 * Keystroke event after correction lookahead. One per position (the first input);
 * retypes collapse into the annotations on that event.
 */
interface AnnotatedKeystrokeEvent extends KeystrokeEvent {
	/** True if the user retyped a correct character at this position later. */
	corrected: boolean;
	/** Ms between the first input and the correcting retype. 0 if never corrected. */
	correctionDelay: number;
}

/** Collapses raw events into first-input-per-position annotations. Analytics credit any correction regardless of delay. */
export function annotateFirstInputs(events: readonly KeystrokeEvent[]): AnnotatedKeystrokeEvent[] {
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
		// Defensive sort — capture emits in order, but callers may not.
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
