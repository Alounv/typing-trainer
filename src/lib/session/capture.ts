import type { Attachment } from 'svelte/attachments';
import type { CaptureConfig, KeystrokeEvent } from '../support/core';

export interface CaptureCallbacks {
	onEvent?: (event: KeystrokeEvent) => void;
	onPositionChange?: (position: number) => void;
	onComplete?: (events: readonly KeystrokeEvent[]) => void;
}

/**
 * We listen on `beforeinput` rather than `keydown` so dead-key composition
 * (`^` + `o` → `ô`) and IME input arrive as composed characters, and so
 * OS-level edits (OPT+Backspace = delete word) come through as semantic
 * `inputType` values. CMD+Backspace is deliberately ignored — wiping the
 * whole drill in one keystroke is almost always an accident.
 *
 * Backspace moves the cursor but does NOT delete prior events — the first
 * input at each position is what counts; retypes are resolved in
 * post-processing.
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
			// for..of splits on Unicode code points, so a surrogate-paired char
			// counts as one keystroke.
			for (const ch of data) insertChar(ch);
		}

		function moveBackBy(n: number) {
			if (n <= 0 || position === 0) return;
			position = Math.max(0, position - n);
			callbacks.onPositionChange?.(position);
		}

		function deleteWord() {
			if (position === 0) return;
			let p = position;
			while (p > 0 && text[p - 1] === ' ') p--;
			while (p > 0 && text[p - 1] !== ' ') p--;
			position = p;
			callbacks.onPositionChange?.(position);
		}

		function handleBeforeInput(e: InputEvent) {
			if (composing) return;
			// We own state — paste / drop / line-delete are swallowed here too.
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
					deleteWord();
					break;
			}
		}

		function handleCompositionStart() {
			composing = true;
		}

		function handleCompositionEnd(e: CompositionEvent) {
			composing = false;
			if (e.data) insertString(e.data);
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
