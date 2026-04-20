<script lang="ts">
	/**
	 * Bigram drill route. Targets come from the dashboard hand-off stash.
	 * Direct nav (URL paste, dev) falls back to a small stub set.
	 */
	import { onMount } from 'svelte';
	import SessionShell from '$lib/session/components/SessionShell.svelte';
	import { prepareBigramDrillSession } from '$lib/practice/session-loader';

	type LoadState =
		| { status: 'loading' }
		| {
				status: 'ready';
				text: string;
				targets: readonly string[];
				/** Subset of `targets` backfilled as exposure; empty for pure-priority drills. */
				exposure: readonly string[];
				/** No priority targets at all — drives the exposure-only header copy. */
				exposureOnly: boolean;
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
	<!-- Header copy flexes by mix — priority-only / mixed / exposure-only. -->
	<SessionShell
		type="bigram-drill"
		text={state.text}
		title="Bigram drill"
		what={state.exposureOnly
			? 'Exposure practice on frequent bigrams. Not enough data yet to diagnose specific weaknesses — this drill builds up samples so the next diagnostic can pinpoint them.'
			: state.exposure.length > 0
				? 'Targeted practice mixing bigrams your diagnostic flagged as weak with frequent bigrams we still need more data on. The passage over-samples all of them.'
				: 'Targeted practice on the bigrams your last diagnostic flagged. The passage over-samples them so each target recurs many times per minute.'}
		approach="Accuracy over speed. Mistype, correct, continue — every transition is measured, so a rushed pass doesn't help."
		targetBigrams={state.targets}
		exposureBigrams={state.exposure}
	/>
{/if}
