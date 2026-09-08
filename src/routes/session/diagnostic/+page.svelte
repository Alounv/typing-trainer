<script lang="ts">
	/**
	 * Diagnostic session route. Assembles a passage of real prose from the
	 * language's quote bank so the bigram distribution matches natural typing.
	 * Falls back to word-synth when the language has no bank.
	 *
	 * Persists nothing a real-text session doesn't: the report it used to
	 * attach held only the pacer's baseline WPM, and the pacer is gone.
	 */
	import { onMount } from 'svelte';
	import SessionShell from '$lib/session/components/SessionShell.svelte';
	import { prepareDiagnosticSession } from './loader';

	type LoadState =
		| { status: 'loading' }
		| { status: 'ready'; text: string }
		| { status: 'error'; message: string };

	let state = $state<LoadState>({ status: 'loading' });

	onMount(async () => {
		try {
			const { text } = await prepareDiagnosticSession();
			state = { status: 'ready', text };
		} catch (err) {
			state = {
				status: 'error',
				message: err instanceof Error ? err.message : 'Failed to build diagnostic passage.'
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
		type="diagnostic"
		text={state.text}
		title="Diagnostic"
		what="A calibration run. We measure your baseline typing speed and flag the bigrams that slow you down."
		approach="Type at a natural pace. There's no score — the point is representative data, not performance."
	/>
{/if}
