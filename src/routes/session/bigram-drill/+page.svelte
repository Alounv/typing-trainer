<script lang="ts">
	/**
	 * Bigram drill route. Targets come from the dashboard hand-off stash.
	 * Direct nav (URL paste, dev) falls back to a small stub set.
	 */
	import { onMount } from 'svelte';
	import SessionShell from '$lib/session/components/SessionShell.svelte';
	import { prepareBigramDrillSession } from '$lib/practice';
	import type { DrillMode } from '$lib/core';

	type LoadState =
		| { status: 'loading' }
		| {
				status: 'ready';
				text: string;
				targets: readonly string[];
				/** Subset of `targets` backfilled as exposure; empty for pure-priority drills. */
				exposure: readonly string[];
				drillMode: DrillMode;
				baselineWPM: number;
		  }
		| { status: 'error'; message: string };

	let state = $state<LoadState>({ status: 'loading' });

	onMount(async () => {
		try {
			const inputs = await prepareBigramDrillSession();
			state = { status: 'ready', ...inputs };
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
	<!--
		Title + instructions flex by drill mode. Accuracy mode targets
		hasty/acquisition bigrams — pacer runs *below* baseline (0.60×) so
		the rhythm discourages rushing. Speed mode targets fluency bigrams —
		pacer runs *above* baseline (1.17×) to push past the current ceiling.
	-->
	<SessionShell
		type="bigram-drill"
		text={state.text}
		title={state.drillMode === 'speed' ? 'Speed drill' : 'Accuracy drill'}
		approach={state.drillMode === 'speed'
			? 'Push the pace. The pacer ghost runs at your target WPM — stay with it or ahead. Accuracy still counts, but this is where you chase speed.'
			: "Slow down. The pacer ghost runs below your baseline on purpose — let it get ahead if you need to. Hitting every key correctly is the whole point."}
		targetBigrams={state.targets}
		exposureBigrams={state.exposure}
		drillMode={state.drillMode}
		baselineWPM={state.baselineWPM}
	/>
{/if}
