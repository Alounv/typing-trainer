import type { Attachment } from 'svelte/attachments';
import type { CaptureConfig, KeystrokeEvent } from '../core';

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
 * Svelte attachment that captures typing on the attached element.
 *
 * Requires the node to be an `<input>` / `<textarea>` (anything that fires
 * `beforeinput`). We intercept `beforeinput` rather than `keydown` because:
 *
 *   - Dead-key composition (e.g. `^` + `o` → `ô`, or macOS option+e + e → `é`)
 *     is surfaced by the browser as a single composed character, not as two
 *     independent keystrokes. `keydown` only sees the raw physical keys.
 *   - OS-level editing shortcuts (OPT+Backspace = delete word, CMD+Backspace
 *     = delete to line start) are reported via semantic `inputType` values.
 *     We honor OPT+Backspace as "back one word" but deliberately ignore
 *     CMD+Backspace — wiping the whole drill with one keystroke is almost
 *     always unintended.
 *
 * Strategy: `preventDefault` on `beforeinput` so the input element itself
 * stays empty — we own state. IME composition is the exception: we let the
 * browser compose in the input, then pick up the result from `compositionend`
 * and clear the value.
 *
 * Backspace moves the cursor but does NOT delete prior events — the first
 * input at each position is what counts; retypes are separate events resolved
 * in post-processing.
 */
export function keystrokeCapture(
	config: CaptureConfig,
	callbacks: CaptureCallbacks = {}
): Attachment<HTMLInputElement | HTMLTextAreaElement> {
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
		// While an IME composition is in flight we let the browser manage the
		// input's value. Committing to our buffer waits for `compositionend`.
		let composing = false;

		function insertChar(ch: string) {
			if (position >= text.length) return;

			const event: KeystrokeEvent = {
				timestamp: performance.now() - startTime,
				expected: text[position],
				actual: ch,
				position,
				wordIndex: wordIndexByPosition[position],
				positionInWord: positionInWordByPosition[position]
			};
			events.push(event);
			callbacks.onEvent?.(event);

			position++;
			callbacks.onPositionChange?.(position);

			if (position >= text.length) {
				callbacks.onComplete?.(events.slice());
			}
		}

		function insertString(data: string) {
			// Iterate with a for..of to split on Unicode code points rather than
			// UTF-16 code units — so an emoji or surrogate-paired char counts as
			// one keystroke, not two.
			for (const ch of data) insertChar(ch);
		}

		function moveBackBy(n: number) {
			if (n <= 0 || position === 0) return;
			position = Math.max(0, position - n);
			callbacks.onPositionChange?.(position);
		}

		function deleteWord() {
			if (position === 0) return;
			// Standard "delete word" semantics: skip trailing spaces, then
			// delete back to the previous space boundary. So "hello world |"
			// collapses to "hello |".
			let p = position;
			while (p > 0 && text[p - 1] === ' ') p--;
			while (p > 0 && text[p - 1] !== ' ') p--;
			position = p;
			callbacks.onPositionChange?.(position);
		}

		function handleBeforeInput(e: InputEvent) {
			// While composing, let the browser mutate the input freely; we'll
			// commit on `compositionend`.
			if (composing) return;

			// Always own the state — never let the input accumulate characters.
			e.preventDefault();

			switch (e.inputType) {
				case 'insertText':
				case 'insertReplacementText':
					if (e.data) insertString(e.data);
					break;
				case 'deleteContentBackward':
					moveBackBy(1);
					break;
				case 'deleteWordBackward':
					// OPT+Backspace. Silent cursor move, matching plain Backspace.
					deleteWord();
					break;
				// deleteSoftLineBackward / deleteHardLineBackward (CMD+Backspace):
				// deliberately ignored. Wiping the whole drill with one keystroke
				// is almost always an accident, and recovering loses all the
				// timing/error context the learner needed to see. OPT+Backspace
				// is the supported "big undo".
				// insertFromPaste / insertFromDrop / anything else: swallowed
				// by the preventDefault above. Paste is deliberately blocked
				// so the trainer can't be gamed.
			}
		}

		function handleCompositionStart() {
			composing = true;
		}

		function handleCompositionEnd(e: CompositionEvent) {
			composing = false;
			if (e.data) insertString(e.data);
			// The browser wrote the composed text into the input; wipe it so
			// subsequent input events start from a clean slate.
			node.value = '';
		}

		node.addEventListener('beforeinput', handleBeforeInput as EventListener);
		node.addEventListener('compositionstart', handleCompositionStart);
		node.addEventListener('compositionend', handleCompositionEnd as EventListener);

		return () => {
			node.removeEventListener('beforeinput', handleBeforeInput as EventListener);
			node.removeEventListener('compositionstart', handleCompositionStart);
			node.removeEventListener('compositionend', handleCompositionEnd as EventListener);
		};
	};
}
