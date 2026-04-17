import type { Attachment } from 'svelte/attachments';
import type { CaptureConfig, KeystrokeEvent } from './types';

/**
 * Callbacks surfaced by the capture attachment. All optional — consumers pick
 * what they need. `onEvent` fires per keystroke, `onPositionChange` per cursor
 * move (including backspace), `onComplete` once when the text is fully typed.
 */
export interface CaptureCallbacks {
	onEvent?: (event: KeystrokeEvent) => void;
	onPositionChange?: (position: number) => void;
	onComplete?: (events: readonly KeystrokeEvent[]) => void;
}

/**
 * Keys that represent modifier presses on their own — dropped because they
 * don't produce characters. (Ctrl/Cmd + key shortcuts are handled separately.)
 */
const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'CapsLock']);

/**
 * Svelte attachment that captures typing on the attached element.
 *
 * - Event buffer is a plain array (not `$state`) so the display doesn't re-render
 *   on every keystroke; consumers subscribe via `onPositionChange` instead.
 * - Backspace moves the cursor but does NOT delete prior events — the first
 *   input at each position is what counts; retypes are separate events resolved
 *   in post-processing.
 * - Node must be focusable and focused (`tabindex="0"`).
 */
export function keystrokeCapture(
	config: CaptureConfig,
	callbacks: CaptureCallbacks = {}
): Attachment<HTMLElement> {
	return (node) => {
		const text = config.text;
		const events: KeystrokeEvent[] = [];
		const startTime = performance.now();

		// Pre-compute word indexing so the hot path does no scanning. Spaces
		// get the previous word's index; the next non-space starts a new word
		// at positionInWord=0.
		//
		//   text:             t  h  e  ␣  c  a  t  ␣  s  a  t
		//   wordIndex:        0  0  0  0  1  1  1  1  2  2  2
		//   positionInWord:   0  1  2  3  0  1  2  3  0  1  2
		const wordIndexByPosition: number[] = [];
		const positionInWordByPosition: number[] = [];
		let wordIdx = 0;
		let posInWord = 0;
		for (let i = 0; i < text.length; i++) {
			wordIndexByPosition.push(wordIdx);
			positionInWordByPosition.push(posInWord);
			if (text[i] === ' ') {
				wordIdx++;
				posInWord = 0;
			} else {
				posInWord++;
			}
		}

		let position = 0;

		function handleKeydown(e: KeyboardEvent) {
			if (MODIFIER_KEYS.has(e.key)) return;
			// Ctrl/Cmd-chorded keys are shortcuts — let them through to the browser.
			if (e.ctrlKey || e.metaKey) return;

			if (e.key === 'Backspace') {
				if (position > 0) {
					position--;
					callbacks.onPositionChange?.(position);
				}
				e.preventDefault();
				return;
			}

			// Printable single-char keys only. Filters out Tab, Arrow*, Enter, F-keys, etc.
			if (e.key.length !== 1) return;

			// Past the end of the expected text — ignore further input.
			if (position >= text.length) return;

			const event: KeystrokeEvent = {
				timestamp: performance.now() - startTime,
				expected: text[position],
				actual: e.key,
				position,
				wordIndex: wordIndexByPosition[position],
				positionInWord: positionInWordByPosition[position]
			};
			events.push(event);
			callbacks.onEvent?.(event);

			position++;
			callbacks.onPositionChange?.(position);
			e.preventDefault();

			if (position >= text.length) {
				// Snapshot so the consumer can't mutate our internal buffer.
				callbacks.onComplete?.(events.slice());
			}
		}

		node.addEventListener('keydown', handleKeydown);
		return () => node.removeEventListener('keydown', handleKeydown);
	};
}
