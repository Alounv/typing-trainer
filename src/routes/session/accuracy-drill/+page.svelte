<script lang="ts">
	/**
	 * Accuracy drill route. Dedicated URL (vs. speed drill) so the treatment
	 * mode is obvious from the nav alone. Behaviour vs. speed-drill:
	 *   - Targets are priority hasty/acquisition bigrams + undertrained backfill
	 *     (picked upstream by the planner; loader just unpacks).
	 *   - Pacer runs at `baselineWPM × 0.60` — slow-down pressure, no speed chase.
	 *   - Copy encourages correctness over throughput.
	 * All data-plane logic is shared via `prepareDrillSession` — this file
	 * stays thin on purpose.
	 */
	import { onMount } from 'svelte';
	import SessionShell from '$lib/session/components/SessionShell.svelte';
	import { prepareDrillSession } from '$lib/practice';

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
		approach="Slow down. The pacer ghost runs below your baseline on purpose — let it get ahead if you need to. Hitting every key correctly is the whole point."
		targetBigrams={state.targets}
		exposureBigrams={state.exposure}
		drillMode="accuracy"
		baselineWPM={state.baselineWPM}
	/>
{/if}
