import type { KeystrokeEvent, KeystrokeStream } from '../support/core';
import { buildWordIndex } from './word-index';

/**
 * Keystroke log ⇄ compact columnar form.
 *
 * The stream is a session's only stored evidence, so this codec is the
 * boundary every downstream statistic trusts: `decodeStream` must reproduce
 * exactly the events `encodeStream` was handed, save for timestamps rounded
 * to whole ms.
 *
 * `expected`, `wordIndex` and `positionInWord` are deliberately not stored —
 * each is a function of the text and the position, so persisting them would
 * write the same fact three times over.
 *
 * Retypes need no marking either: they are simply two entries at one
 * position, and their order in the stream is what distinguishes first input
 * from correction.
 */

/**
 * Assumes `events` is in emission order with non-decreasing timestamps, which
 * is what `keystrokeCapture` produces.
 *
 * Absolute timestamps are rounded first and *then* delta-encoded — rounding
 * each delta on its own would let the error accumulate across the session.
 */
export function encodeStream(events: readonly KeystrokeEvent[]): KeystrokeStream {
	const positions = new Int16Array(events.length);
	const times = new Uint32Array(events.length);
	let typed = '';
	let previousPosition = 0;
	let previousTime = 0;

	for (let i = 0; i < events.length; i++) {
		const event = events[i];
		const time = Math.max(0, Math.round(event.timestamp));
		positions[i] = event.position - previousPosition;
		times[i] = Math.max(0, time - previousTime);
		typed += event.actual;
		previousPosition = event.position;
		previousTime = time;
	}

	return { positions, times, typed };
}

/**
 * Replays a stored stream against its text. Throws rather than guessing: a
 * column-length mismatch or an out-of-range position means the row is
 * corrupt, and silently emitting an `undefined` expected character would
 * poison every aggregate derived from it.
 */
export function decodeStream(stream: KeystrokeStream, text: string): KeystrokeEvent[] {
	// Code points, not code units — a surrogate-paired character is one
	// keystroke, matching how `keystrokeCapture` splits input.
	const typed = Array.from(stream.typed);
	const count = stream.positions.length;
	if (stream.times.length !== count || typed.length !== count) {
		throw new Error(
			`Corrupt keystroke stream: ${count} positions, ${stream.times.length} times, ${typed.length} characters.`
		);
	}

	const { wordIndexByPosition, positionInWordByPosition } = buildWordIndex(text);
	const events: KeystrokeEvent[] = [];
	let position = 0;
	let timestamp = 0;

	for (let i = 0; i < count; i++) {
		position += stream.positions[i];
		timestamp += stream.times[i];
		if (position < 0 || position >= text.length) {
			throw new Error(
				`Corrupt keystroke stream: entry ${i} lands at position ${position}, outside a ${text.length}-character text.`
			);
		}
		events.push({
			timestamp,
			expected: text[position],
			actual: typed[i],
			position,
			wordIndex: wordIndexByPosition[position],
			positionInWord: positionInWordByPosition[position]
		});
	}

	return events;
}
