import { describe, it, expect, vi } from 'vitest';
import { keystrokeCapture, type CaptureCallbacks } from './capture';
import type { KeystrokeEvent } from './types';

/**
 * The capture attachment only uses `addEventListener` / `removeEventListener`
 * on the node — no layout, no focus, no composition. A tiny in-memory stub
 * lets us exercise the handler without pulling in jsdom or a real browser.
 */
function makeNode() {
	const listeners = new Map<string, Set<(e: KeyboardEvent) => void>>();
	const node = {
		addEventListener(type: string, fn: (e: KeyboardEvent) => void) {
			if (!listeners.has(type)) listeners.set(type, new Set());
			listeners.get(type)!.add(fn);
		},
		removeEventListener(type: string, fn: (e: KeyboardEvent) => void) {
			listeners.get(type)?.delete(fn);
		}
	} as unknown as HTMLElement;

	function dispatch(init: Partial<KeyboardEvent>) {
		const e = {
			key: '',
			ctrlKey: false,
			metaKey: false,
			preventDefault: () => {},
			...init
		} as KeyboardEvent;
		for (const fn of listeners.get('keydown') ?? []) fn(e);
	}

	return {
		node,
		dispatch,
		listenerCount: (type: string) => listeners.get(type)?.size ?? 0
	};
}

/** Attach the capture and return handles to drive it from the test. */
function attach(text: string, callbacks: CaptureCallbacks = {}) {
	const { node, dispatch, listenerCount } = makeNode();
	const cleanup = keystrokeCapture({ text }, callbacks)(node);
	return { dispatch, listenerCount, cleanup: cleanup as () => void };
}

describe('keystrokeCapture', () => {
	it('records a correct keystroke with the expected fields', () => {
		const events: KeystrokeEvent[] = [];
		const { dispatch } = attach('hi', { onEvent: (e) => events.push(e) });

		dispatch({ key: 'h' });

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
		const { dispatch } = attach('hi', { onEvent: (e) => events.push(e) });

		dispatch({ key: 'x' });
		dispatch({ key: 'i' });

		expect(events.map((e) => [e.expected, e.actual])).toEqual([
			['h', 'x'],
			['i', 'i']
		]);
	});

	it('ignores modifier-only presses and Ctrl/Cmd-chorded keys', () => {
		const onEvent = vi.fn();
		const { dispatch } = attach('abc', { onEvent });

		dispatch({ key: 'Shift' });
		dispatch({ key: 'Control' });
		dispatch({ key: 'Meta' });
		dispatch({ key: 'CapsLock' });
		dispatch({ key: 'r', ctrlKey: true });
		dispatch({ key: 'c', metaKey: true });

		expect(onEvent).not.toHaveBeenCalled();
	});

	it('ignores non-printable keys like Tab / Arrow* / Enter / F-keys', () => {
		const onEvent = vi.fn();
		const { dispatch } = attach('abc', { onEvent });

		dispatch({ key: 'Tab' });
		dispatch({ key: 'Enter' });
		dispatch({ key: 'ArrowLeft' });
		dispatch({ key: 'F5' });
		dispatch({ key: 'Escape' });

		expect(onEvent).not.toHaveBeenCalled();
	});

	it('backspace moves the cursor back without emitting an event', () => {
		const onEvent = vi.fn();
		const positions: number[] = [];
		const { dispatch } = attach('abc', {
			onEvent,
			onPositionChange: (p) => positions.push(p)
		});

		dispatch({ key: 'a' }); // pos 0 → 1
		dispatch({ key: 'b' }); // pos 1 → 2
		dispatch({ key: 'Backspace' }); // pos 2 → 1

		expect(onEvent).toHaveBeenCalledTimes(2);
		expect(positions).toEqual([1, 2, 1]);
	});

	it('backspace at position 0 is a no-op', () => {
		const positions: number[] = [];
		const { dispatch } = attach('abc', {
			onPositionChange: (p) => positions.push(p)
		});

		dispatch({ key: 'Backspace' });

		expect(positions).toEqual([]);
	});

	it('retypes after backspace produce additional events at the same position', () => {
		const events: KeystrokeEvent[] = [];
		const { dispatch } = attach('the', { onEvent: (e) => events.push(e) });

		dispatch({ key: 't' }); // pos 0
		dispatch({ key: 'e' }); // pos 1, wrong (expected 'h')
		dispatch({ key: 'Backspace' }); // back to pos 1
		dispatch({ key: 'h' }); // pos 1, correct this time
		dispatch({ key: 'e' }); // pos 2

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
		const { dispatch } = attach('ab cd', { onEvent: (e) => events.push(e) });

		for (const key of ['a', 'b', ' ', 'c', 'd']) dispatch({ key });

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
		const { dispatch } = attach('hi', { onEvent });

		dispatch({ key: 'h' });
		dispatch({ key: 'i' });
		dispatch({ key: 'x' }); // past end

		expect(onEvent).toHaveBeenCalledTimes(2);
	});

	it('fires onComplete exactly once with a snapshot of all events', () => {
		const onComplete = vi.fn();
		const { dispatch } = attach('hi', { onComplete });

		dispatch({ key: 'h' });
		expect(onComplete).not.toHaveBeenCalled();
		dispatch({ key: 'i' });
		expect(onComplete).toHaveBeenCalledTimes(1);

		const snapshot = onComplete.mock.calls[0][0] as readonly KeystrokeEvent[];
		expect(snapshot).toHaveLength(2);

		// Snapshot must not reflect later mutations to the internal buffer.
		dispatch({ key: 'x' }); // ignored — past end — but confirms no mutation leaks.
		expect(snapshot).toHaveLength(2);
	});

	it('cleanup removes the keydown listener', () => {
		const onEvent = vi.fn();
		const { dispatch, listenerCount, cleanup } = attach('abc', { onEvent });

		expect(listenerCount('keydown')).toBe(1);
		cleanup();
		expect(listenerCount('keydown')).toBe(0);

		dispatch({ key: 'a' });
		expect(onEvent).not.toHaveBeenCalled();
	});
});
