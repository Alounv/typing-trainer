<script lang="ts">
	/**
	 * Diagnostic session route. Generates a passage sized for spec §2.5
	 * (~500–800 keystrokes) that biases toward the top-50 corpus bigrams
	 * so the downstream report has enough observations to classify each.
	 *
	 * Shell-driven: raw events persisted so thresholds can be replayed
	 * later (spec §2.8).
	 */
	import { onMount } from 'svelte';
	import SessionShell from '$lib/session/components/SessionShell.svelte';
	import { loadBuiltinCorpus } from '$lib/corpus/registry';
	import { sampleDiagnosticPassage } from '$lib/diagnostic/sampler';

	type LoadState =
		| { status: 'loading' }
		| { status: 'ready'; text: string }
		| { status: 'error'; message: string };

	let state = $state<LoadState>({ status: 'loading' });

	onMount(async () => {
		try {
			// Use the synth path (no quote bank): the target-bigram boost
			// lives in `selectRealTextSentence`, and the diagnostic wants
			// coverage more than literary naturalness.
			const corpus = await loadBuiltinCorpus('en-top-1000');
			const passage = sampleDiagnosticPassage(corpus);
			state = { status: 'ready', text: passage.text };
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
		lede="Type the passage below. Errors are recorded but not blocked — just keep going."
		persistRawEvents
	/>
{/if}
