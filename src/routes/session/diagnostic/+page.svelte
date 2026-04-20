<script lang="ts">
	/**
	 * Diagnostic session route. Assembles a passage of real prose from the
	 * language's quote bank so the bigram distribution matches natural typing.
	 * Falls back to word-synth when the language has no bank. On finish, builds
	 * a `DiagnosticReport` from the in-memory events + aggregates and attaches
	 * it to the persisted summary.
	 */
	import { onMount } from 'svelte';
	import SessionShell from '$lib/session/components/SessionShell.svelte';
	import { prepareDiagnosticSession } from '$lib/practice/session-loader';
	import { generateDiagnosticReport } from '$lib/diagnostic/engine';
	import type { FrequencyTable } from '$lib/corpus/types';

	type LoadState =
		| { status: 'loading' }
		| { status: 'ready'; text: string; corpusBigramFrequencies: FrequencyTable }
		| { status: 'error'; message: string };

	let state = $state<LoadState>({ status: 'loading' });

	onMount(async () => {
		try {
			const inputs = await prepareDiagnosticSession();
			state = { status: 'ready', ...inputs };
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
	{@const corpusBigramFrequencies = state.corpusBigramFrequencies}
	<SessionShell
		type="diagnostic"
		text={state.text}
		title="Diagnostic"
		what="A calibration run. We measure your baseline typing speed and flag the bigrams that slow you down."
		approach="Type at a natural pace. There's no score — the point is representative data, not performance."
		buildDiagnosticReport={(summary, events) =>
			generateDiagnosticReport({
				sessionId: summary.id,
				timestamp: summary.timestamp,
				events,
				aggregates: summary.bigramAggregates,
				corpusBigramFrequencies
			})}
	/>
{/if}
