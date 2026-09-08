<script lang="ts">
	/**
	 * The session route. Picks a passage from the quote bank by how much of the
	 * typist's outstanding bigram debt it can repay.
	 */
	import { onMount } from 'svelte';
	import SessionShell from '$lib/session/components/SessionShell.svelte';
	import { prepareRealTextSession } from './loader';

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
		approach="Aim for a few errors, not none — somewhere around 2-5%. Keep moving; nothing here blocks you, and the verdict comes at the end."
	/>
{/if}
