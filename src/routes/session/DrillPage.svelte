<script lang="ts">
	/** Shared shell for the two drill routes — copy + mode differ; data plane is shared. */
	import { onMount } from 'svelte';
	import SessionShell from '$lib/session/components/SessionShell.svelte';
	import type { DrillMode } from '$lib/support/core';
	import { prepareDrillSession } from './drill-loader';

	const COPY: Record<DrillMode, { title: string; approach: string }> = {
		accuracy: {
			title: 'Accuracy drill',
			approach:
				'Slow down. Hitting every key correctly is the whole point — take the time you need.'
		},
		speed: {
			title: 'Speed drill',
			approach:
				'Push the pace. The pacer ghost runs at your target WPM — stay with it or ahead. Accuracy still counts, but this is where you chase speed.'
		}
	};

	type LoadState =
		| { status: 'loading' }
		| {
				status: 'ready';
				text: string;
				targets: readonly string[];
				exposure: readonly string[];
				baselineWPM: number;
		  }
		| { status: 'error'; message: string };

	let { mode }: { mode: DrillMode } = $props();
	let state = $state<LoadState>({ status: 'loading' });

	onMount(async () => {
		try {
			const inputs = await prepareDrillSession(mode);
			state = {
				status: 'ready',
				text: inputs.text,
				targets: inputs.targets,
				exposure: inputs.exposure,
				baselineWPM: inputs.baselineWPM
			};
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
		title={COPY[mode].title}
		approach={COPY[mode].approach}
		targetBigrams={state.targets}
		exposureBigrams={state.exposure}
		drillMode={mode}
		baselineWPM={state.baselineWPM}
	/>
{/if}
