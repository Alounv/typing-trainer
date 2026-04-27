import type { KeystrokeEvent } from '../support/core';

/**
 * One per position (the first input); retypes collapse into annotations on
 * that event.
 */
interface AnnotatedKeystrokeEvent extends KeystrokeEvent {
	corrected: boolean;
	/** Ms between first input and correcting retype. 0 if never corrected. */
	correctionDelay: number;
}

/** Analytics credit any correction regardless of delay. */
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
