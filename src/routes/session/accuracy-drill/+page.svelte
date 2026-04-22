<script lang="ts">
	/**
	 * Accuracy drill route. Dedicated URL (vs. speed drill) so the treatment
	 * mode is obvious from the nav alone. Behaviour vs. speed-drill:
	 *   - Targets are priority hasty/acquisition bigrams + undertrained backfill
	 *     (picked upstream by the planner; loader just unpacks).
	 *   - No pacer: nothing to chase, nothing to slow down against. Removes
	 *     speed pressure entirely so the user can focus on correctness.
	 *   - Copy encourages correctness over throughput.
	 * All data-plane logic is shared via `prepareDrillSession` — this file
	 * stays thin on purpose.
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
			const inputs = await prepareDrillSession('accuracy');
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
		title="Accuracy drill"
		approach="Slow down. Hitting every key correctly is the whole point — take the time you need."
		targetBigrams={state.targets}
		exposureBigrams={state.exposure}
		drillMode="accuracy"
		baselineWPM={state.baselineWPM}
	/>
{/if}
