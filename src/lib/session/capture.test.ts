import { describe, it, expect, vi } from 'vitest';
import { keystrokeCapture, type CaptureCallbacks } from './capture';
import type { KeystrokeEvent } from '../support/core';

/**
 * The capture attachment only uses `addEventListener` / `removeEventListener`
 * on the node — plus `node.value = ''` to clear composed text. A tiny
 * in-memory stub lets us exercise the handlers without pulling in jsdom or
 * a real browser.
 */
function makeNode() {
	const listeners = new Map<string, Set<(e: Event) => void>>();
	let value = '';

	const node = {
		addEventListener(type: string, fn: (e: Event) => void) {
			if (!listeners.has(type)) listeners.set(type, new Set());
			listeners.get(type)!.add(fn);
		},
		removeEventListener(type: string, fn: (e: Event) => void) {
			listeners.get(type)?.delete(fn);
		},
		get value() {
			return value;
		},
		set value(v: string) {
			value = v;
		}
	} as unknown as HTMLInputElement;

	function dispatch(type: string, init: Record<string, unknown> = {}) {
		let defaultPrevented = false;
		const e = {
			data: null,
			inputType: '',
			preventDefault: () => {
				defaultPrevented = true;
			},
			...init
		} as unknown as Event;
		for (const fn of listeners.get(type) ?? []) fn(e);
		return { defaultPrevented };
	}

	/** Shorthand: fire a `beforeinput` with the given `inputType` + `data`. */
	function beforeInput(inputType: string, data: string | null = null) {
		return dispatch('beforeinput', { inputType, data });
	}

	return {
		node,
		dispatch,
		beforeInput,
		getValue: () => value,
		setValue: (v: string) => {
			value = v;
		},
		listenerCount: (type: string) => listeners.get(type)?.size ?? 0
	};
}

/** Attach the capture and return handles to drive it from the test. */
function attach(text: string, callbacks: CaptureCallbacks = {}) {
	const handles = makeNode();
	const cleanup = keystrokeCapture({ text }, callbacks)(handles.node);
	return { ...handles, cleanup: cleanup as () => void };
}

describe('keystrokeCapture', () => {
	it('records a correct keystroke from insertText with the expected fields', () => {
		const events: KeystrokeEvent[] = [];
		const { beforeInput } = attach('hi', { onEvent: (e) => events.push(e) });

		beforeInput('insertText', 'h');

		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			expected: 'h',
			actual: 'h',
			position: 0,
			wordIndex: 0,
			positionInWord: 0
		});
		expect(events[0].timestamp).toBeGreaterThanOrEqual(0);
	});

	it('records a wrong keystroke without halting', () => {
		const events: KeystrokeEvent[] = [];
		const { beforeInput } = attach('hi', { onEvent: (e) => events.push(e) });

		beforeInput('insertText', 'x');
		beforeInput('insertText', 'i');

		expect(events.map((e) => [e.expected, e.actual])).toEqual([
			['h', 'x'],
			['i', 'i']
		]);
	});

	it('always preventDefaults beforeinput so the input never accumulates text', () => {
		// Critical invariant: if the input's own value grew, subsequent diffs
		// would be wrong. The attachment must own all state.
		const { beforeInput } = attach('abc');

		expect(beforeInput('insertText', 'a').defaultPrevented).toBe(true);
		expect(beforeInput('deleteContentBackward').defaultPrevented).toBe(true);
	});

	it('splits a multi-char insertText (dead-key composition on macOS) into per-char events', () => {
		// Typing `^` + `o` on a French keyboard surfaces as a single beforeinput
		// with data = `ô` — but for something like `^~` a system might emit
		// two chars in one event. Either way, we count each grapheme as one
		// keystroke against the expected text.
		const events: KeystrokeEvent[] = [];
		const { beforeInput } = attach('ôe', { onEvent: (e) => events.push(e) });

		beforeInput('insertText', 'ôe');

		expect(events.map((e) => [e.position, e.actual])).toEqual([
			[0, 'ô'],
			[1, 'e']
		]);
	});

	it('iterates over code points, not UTF-16 code units, for surrogate-paired chars', () => {
		// An emoji like 🙂 is two UTF-16 code units but one grapheme/keystroke.
		const text = '🙂';
		const events: KeystrokeEvent[] = [];
		const { beforeInput } = attach(text, { onEvent: (e) => events.push(e) });

		beforeInput('insertText', '🙂');

		expect(events).toHaveLength(1);
		expect(events[0].actual).toBe('🙂');
	});

	it('commits IME composition on compositionend and clears the input value', () => {
		const events: KeystrokeEvent[] = [];
		const { dispatch, getValue, setValue } = attach('éà', {
			onEvent: (e) => events.push(e)
		});

		// Simulate composition flow: the input accumulates the composed text,
		// we ignore beforeinput events during composition, then pick it up
		// at compositionend and wipe the input.
		dispatch('compositionstart', {});
		setValue('éà');
		// beforeinput fired mid-composition must NOT advance the cursor.
		dispatch('beforeinput', { inputType: 'insertCompositionText', data: 'éà' });
		expect(events).toHaveLength(0);

		dispatch('compositionend', { data: 'éà' });

		expect(events.map((e) => e.actual)).toEqual(['é', 'à']);
		expect(getValue()).toBe('');
	});

	it('deleteContentBackward (plain Backspace) moves the cursor back without emitting', () => {
		const onEvent = vi.fn();
		const positions: number[] = [];
		const { beforeInput } = attach('abc', {
			onEvent,
			onPositionChange: (p) => positions.push(p)
		});

		beforeInput('insertText', 'a'); // pos 0 → 1
		beforeInput('insertText', 'b'); // pos 1 → 2
		beforeInput('deleteContentBackward'); // pos 2 → 1

		expect(onEvent).toHaveBeenCalledTimes(2);
		expect(positions).toEqual([1, 2, 1]);
	});

	it('deleteContentBackward at position 0 is a no-op', () => {
		const positions: number[] = [];
		const { beforeInput } = attach('abc', {
			onPositionChange: (p) => positions.push(p)
		});

		beforeInput('deleteContentBackward');

		expect(positions).toEqual([]);
	});

	it('deleteWordBackward (OPT+Backspace) moves silently to the previous word boundary', () => {
		const onEvent = vi.fn();
		const positions: number[] = [];
		const { beforeInput } = attach('hello world foo', {
			onEvent,
			onPositionChange: (p) => positions.push(p)
		});

		// Type "hello world f" — position reaches 13.
		for (const ch of 'hello world f') beforeInput('insertText', ch);
		expect(positions.at(-1)).toBe(13);

		beforeInput('deleteWordBackward');

		// Expect to land at index 12 — the start of "foo", just after the space.
		expect(positions.at(-1)).toBe(12);
		// Word-delete emits no keystroke events, same as plain Backspace.
		expect(onEvent).toHaveBeenCalledTimes(13);
	});

	it('deleteWordBackward invoked right after a space jumps to the start of the previous word', () => {
		// Cursor sitting on a trailing space: "hello |" → "|".
		const positions: number[] = [];
		const { beforeInput } = attach('hello world', {
			onPositionChange: (p) => positions.push(p)
		});

		for (const ch of 'hello ') beforeInput('insertText', ch);
		expect(positions.at(-1)).toBe(6);

		beforeInput('deleteWordBackward');

		expect(positions.at(-1)).toBe(0);
	});

	it('deleteSoftLineBackward / deleteHardLineBackward (CMD+Backspace) is ignored', () => {
		const onEvent = vi.fn();
		const positions: number[] = [];
		const { beforeInput } = attach('hello world', {
			onEvent,
			onPositionChange: (p) => positions.push(p)
		});

		for (const ch of 'hello wo') beforeInput('insertText', ch);
		const soft = beforeInput('deleteSoftLineBackward');
		const hard = beforeInput('deleteHardLineBackward');

		// Cursor must stay put — no "nuke everything" shortcut.
		expect(positions.at(-1)).toBe(8);
		// Still prevented so the input element itself never accumulates text.
		expect(soft.defaultPrevented).toBe(true);
		expect(hard.defaultPrevented).toBe(true);
		expect(onEvent).toHaveBeenCalledTimes(8);
	});

	it('blocks paste by swallowing insertFromPaste and insertFromDrop', () => {
		const onEvent = vi.fn();
		const positions: number[] = [];
		const { beforeInput } = attach('abc', {
			onEvent,
			onPositionChange: (p) => positions.push(p)
		});

		// The browser would attach the pasted text to `event.dataTransfer`;
		// all we need to verify is that we don't advance state from it.
		const paste = beforeInput('insertFromPaste', 'abc');
		const drop = beforeInput('insertFromDrop', 'abc');

		expect(paste.defaultPrevented).toBe(true);
		expect(drop.defaultPrevented).toBe(true);
		expect(onEvent).not.toHaveBeenCalled();
		expect(positions).toEqual([]);
	});

	it('retypes after backspace produce additional events at the same position', () => {
		const events: KeystrokeEvent[] = [];
		const { beforeInput } = attach('the', { onEvent: (e) => events.push(e) });

		beforeInput('insertText', 't'); // pos 0
		beforeInput('insertText', 'e'); // pos 1, wrong (expected 'h')
		beforeInput('deleteContentBackward'); // back to pos 1
		beforeInput('insertText', 'h'); // pos 1, correct this time
		beforeInput('insertText', 'e'); // pos 2

		// Four forward keystrokes — one correct at pos 0, one wrong + one
		// correct at pos 1, one correct at pos 2. First-input semantics are
		// postprocess's job; capture just records them all.
		expect(events.map((e) => [e.position, e.actual])).toEqual([
			[0, 't'],
			[1, 'e'],
			[1, 'h'],
			[2, 'e']
		]);
	});

	it('computes wordIndex and positionInWord across spaces', () => {
		const events: KeystrokeEvent[] = [];
		const { beforeInput } = attach('ab cd', { onEvent: (e) => events.push(e) });

		for (const ch of 'ab cd') beforeInput('insertText', ch);

		expect(events.map((e) => [e.wordIndex, e.positionInWord])).toEqual([
			[0, 0], // 'a'
			[0, 1], // 'b'
			[0, 2], // ' ' — space stays on the preceding word's index
			[1, 0], // 'c'
			[1, 1] // 'd'
		]);
	});

	it('ignores input past the end of the expected text', () => {
		const onEvent = vi.fn();
		const { beforeInput } = attach('hi', { onEvent });

		beforeInput('insertText', 'h');
		beforeInput('insertText', 'i');
		beforeInput('insertText', 'x'); // past end

		expect(onEvent).toHaveBeenCalledTimes(2);
	});

	it('fires onComplete exactly once with a snapshot of all events', () => {
		const onComplete = vi.fn();
		const { beforeInput } = attach('hi', { onComplete });

		beforeInput('insertText', 'h');
		expect(onComplete).not.toHaveBeenCalled();
		beforeInput('insertText', 'i');
		expect(onComplete).toHaveBeenCalledTimes(1);

		const snapshot = onComplete.mock.calls[0][0] as readonly KeystrokeEvent[];
		expect(snapshot).toHaveLength(2);

		// Snapshot must not reflect later mutations to the internal buffer.
		beforeInput('insertText', 'x'); // ignored — past end — but confirms no mutation leaks.
		expect(snapshot).toHaveLength(2);
	});

	it('cleanup removes every listener the attachment installed', () => {
		const onEvent = vi.fn();
		const { beforeInput, listenerCount, cleanup } = attach('abc', { onEvent });

		expect(listenerCount('beforeinput')).toBe(1);
		expect(listenerCount('compositionstart')).toBe(1);
		expect(listenerCount('compositionend')).toBe(1);

		cleanup();

		expect(listenerCount('beforeinput')).toBe(0);
		expect(listenerCount('compositionstart')).toBe(0);
		expect(listenerCount('compositionend')).toBe(0);

		beforeInput('insertText', 'a');
		expect(onEvent).not.toHaveBeenCalled();
	});
});
