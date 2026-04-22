<script lang="ts">
	/**
	 * Speed drill route. Counterpart to accuracy-drill:
	 *   - Targets are fluency bigrams only (accurate-but-slow).
	 *   - Pacer runs at `baselineWPM × 1.17` — the same `targetWPM` the
	 *     diagnostic report surfaces; the goal is to catch up to the ghost.
	 *   - Copy encourages pushing the pace.
	 * Data-plane logic shared via `prepareDrillSession`.
	 */
	import { onMount } from 'svelte';
	import SessionShell from '$lib/session/components/SessionShell.svelte';
	import { prepareDrillSession } from '../drill-loader';

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

	let state = $state<LoadState>({ status: 'loading' });

	onMount(async () => {
		try {
			const inputs = await prepareDrillSession('speed');
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
		title="Speed drill"
		approach="Push the pace. The pacer ghost runs at your target WPM — stay with it or ahead. Accuracy still counts, but this is where you chase speed."
		targetBigrams={state.targets}
		exposureBigrams={state.exposure}
		drillMode="speed"
		baselineWPM={state.baselineWPM}
	/>
{/if}
