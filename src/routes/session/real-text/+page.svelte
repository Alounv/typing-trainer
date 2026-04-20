<script lang="ts">
	/**
	 * Real-text session route. Loads quote bank + fallback corpus, generates a
	 * passage sized to the planned word budget. Self-contained mini-workout.
	 */
	import { onMount } from 'svelte';
	import SessionShell from '$lib/session/components/SessionShell.svelte';
	import { prepareRealTextSession } from '$lib/practice';

	type LoadState =
		| { status: 'loading' }
		| { status: 'ready'; text: string }
		| { status: 'error'; message: string };

	let state = $state<LoadState>({ status: 'loading' });

	onMount(async () => {
		try {
			const { text } = await prepareRealTextSession();
			state = { status: 'ready', text };
		} catch (err) {
			state = {
				status: 'error',
				message: err instanceof Error ? err.message : 'Failed to build passage.'
			};
		}
	});
</script>

{#if state.status === 'loading'}
	<p class="mx-auto max-w-3xl text-base-content/70">Loading passage…</p>
{:else if state.status === 'error'}
	<p class="mx-auto max-w-3xl text-error" role="alert">{state.message}</p>
{:else}
	<SessionShell
		type="real-text"
		text={state.text}
		title="Real text"
		approach="Where drill precision becomes typing flow. Keep moving; errors are recorded but never blocking."
	/>
{/if}
