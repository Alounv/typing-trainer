<script lang="ts">
	import { onMount } from 'svelte';
	import { loadAnalyticsInputs } from './loader';
	import Analytics from '$lib/progress/components/Analytics.svelte';
	import type { ClassificationThresholds, SessionSummary } from '$lib/support/core';
	import type { FrequencyTable } from '$lib/corpus';
	import { VERSION } from '$lib/version';

	type LoadState =
		| { status: 'loading' }
		| {
				status: 'ready';
				sessions: SessionSummary[];
				diagnosticSessions: SessionSummary[];
				corpusFrequencies: FrequencyTable | undefined;
				thresholds: ClassificationThresholds;
		  }
		| { status: 'error'; message: string };

	let state = $state<LoadState>({ status: 'loading' });

	onMount(async () => {
		try {
			const { sessions, diagnosticSessions, corpusFrequencies, thresholds } =
				await loadAnalyticsInputs();
			state = { status: 'ready', sessions, diagnosticSessions, corpusFrequencies, thresholds };
		} catch (err) {
			state = {
				status: 'error',
				message: err instanceof Error ? err.message : 'Failed to load analytics.'
			};
		}
	});
</script>

<div class="mx-auto max-w-3xl space-y-10">
	<header class="space-y-3">
		<p class="text-xs font-medium tracking-[0.18em] text-base-content/50 uppercase">
			Progress · {VERSION}
		</p>
		<h1 class="text-4xl font-semibold tracking-tight text-base-content">Analytics</h1>
		<p class="text-base-content/65">WPM trend, bigram breakdown, diagnostic history.</p>
	</header>

	{#if state.status === 'loading'}
		<p class="text-base-content/60">Loading…</p>
	{:else if state.status === 'error'}
		<p class="text-error" role="alert">{state.message}</p>
	{:else}
		<Analytics
			sessions={state.sessions}
			diagnosticSessions={state.diagnosticSessions}
			corpusFrequencies={state.corpusFrequencies}
			thresholds={state.thresholds}
		/>
	{/if}
</div>
