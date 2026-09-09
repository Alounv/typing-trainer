import { onMount } from 'svelte';

type Loaded<T> =
	| { status: 'loading' }
	| { status: 'ready'; data: T }
	| { status: 'error'; message: string };

/**
 * Loading lives here rather than in SvelteKit's `load` because the data is
 * client-side only — IndexedDB, and a corpus chunk that exists in the browser.
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
