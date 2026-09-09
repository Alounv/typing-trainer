import { onMount } from 'svelte';

type Loaded<T> =
	| { status: 'loading' }
	| { status: 'ready'; data: T }
	| { status: 'error'; message: string };

/**
 * Run a route-local loader on mount and expose the three states a page has to
 * render anyway: loading, ready, failed.
 *
 * Every route was hand-rolling this — the same `$state` union, the same
 * `onMount` try/catch, the same `err instanceof Error` unwrap. Data loading is
 * client-side (IndexedDB, and a corpus chunk that only exists in the browser),
 * so it cannot move into SvelteKit's `load`.
 *
 * Call during component initialisation, like any rune.
 */
export function loadable<T>(
	load: () => Promise<T>,
	fallbackMessage: string
): { current: Loaded<T> } {
	let state = $state<Loaded<T>>({ status: 'loading' });

	onMount(async () => {
		try {
			state = { status: 'ready', data: await load() };
		} catch (err) {
			state = { status: 'error', message: err instanceof Error ? err.message : fallbackMessage };
		}
	});

	return {
		get current() {
			return state;
		}
	};
}
