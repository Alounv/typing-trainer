import type { KeystrokeEvent } from '../support/core';

/**
 * One per position (the first input); retypes collapse into annotations on
 * that event.
 */
interface AnnotatedKeystrokeEvent extends KeystrokeEvent {
	corrected: boolean;
	/** Ms between first input and correcting retype. 0 if never corrected. */
	correctionDelay: number;
	/**
	 * True iff this position's first input was wrong AND the immediately preceding
	 * position's first input was also wrong. Marks fumble follow-ups so downstream
	 * stats can drop them — only the first error in a burst should count.
	 */
	burstFollowUp: boolean;
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

		annotated.push({ ...first, corrected, correctionDelay, burstFollowUp: false });
	}

	annotated.sort((a, b) => a.position - b.position);

	for (let i = 1; i < annotated.length; i++) {
		const cur = annotated[i];
		const prev = annotated[i - 1];
		const curWrong = cur.actual !== cur.expected;
		const prevWrong = prev.actual !== prev.expected;
		const adjacent = prev.position === cur.position - 1;
		cur.burstFollowUp = curWrong && prevWrong && adjacent;
	}

	return annotated;
}
