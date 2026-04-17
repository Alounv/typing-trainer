<script lang="ts">
	/**
	 * Bigram drill route. Loads a built-in corpus and generates a
	 * sequence targeting a stub set of common-trouble bigrams until the
	 * Phase 6 scheduler can supply real priority targets from the most
	 * recent diagnostic.
	 */
	import { onMount } from 'svelte';
	import SessionShell from '$lib/session/components/SessionShell.svelte';
	import { loadBuiltinCorpus } from '$lib/corpus/registry';
	import { generateBigramDrillSequence } from '$lib/drill/bigram-drill';
	import { phaseTargetMsFromWPM } from '$lib/session/graduation';

	/**
	 * Placeholder target bigrams. Phase 6 will swap these for the priority
	 * list from the latest DiagnosticReport. Chosen for frequency in
	 * English so the drill is exercised by typical words.
	 */
	const STUB_TARGETS = ['th', 'he', 'in', 'er', 'an'] as const;

	/**
	 * Assumed baseline when no diagnostic has ever run. Graduation uses
	 * 60% of this for acquisition/hasty-style pacing (spec §4.1); real
	 * drills will read baseline from the progress store.
	 */
	const DEFAULT_BASELINE_WPM = 60;
	const PHASE_WPM = DEFAULT_BASELINE_WPM * 0.6;

	type LoadState =
		| { status: 'loading' }
		| { status: 'ready'; text: string }
		| { status: 'error'; message: string };

	let state = $state<LoadState>({ status: 'loading' });

	onMount(async () => {
		try {
			const corpus = await loadBuiltinCorpus('en-top-1000');
			const seq = generateBigramDrillSequence({
				targetBigrams: STUB_TARGETS,
				corpus
			});
			state = { status: 'ready', text: seq.text };
		} catch (err) {
			state = {
				status: 'error',
				message: err instanceof Error ? err.message : 'Failed to build drill.'
			};
		}
	});
</script>

{#if state.status === 'loading'}
	<p class="mx-auto max-w-3xl text-base-content/70">Loading drill…</p>
{:else if state.status === 'error'}
	<p class="mx-auto max-w-3xl text-error" role="alert">{state.message}</p>
{:else}
	<SessionShell
		type="bigram-drill"
		text={state.text}
		title="Bigram drill"
		lede="Targeted drill on common trouble pairs. A bigram graduates after 15 clean samples at pace."
		targetBigrams={STUB_TARGETS}
		graduationTargetMs={phaseTargetMsFromWPM(PHASE_WPM)}
	/>
{/if}
