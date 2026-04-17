<script lang="ts">
	/**
	 * Bigram drill route. Receives its target bigrams from the dashboard
	 * via the hand-off stash (spec §5). Falls back to a small stub set
	 * when invoked directly (URL paste, dev nav) so the route always
	 * has *something* to drill.
	 */
	import { onMount } from 'svelte';
	import SessionShell from '$lib/session/components/SessionShell.svelte';
	import { loadBuiltinCorpus } from '$lib/corpus/registry';
	import { generateBigramDrillSequence } from '$lib/drill/bigram-drill';
	import { phaseTargetMsFromWPM } from '$lib/session/graduation';
	import { consumePlannedSession } from '$lib/scheduler/handoff';
	import { DEFAULT_BIGRAM_DRILL_WORD_BUDGET } from '$lib/models';

	/**
	 * Fallback targets. Only used when the user lands here without a
	 * dashboard hand-off (direct URL, dev). Chosen for frequency in
	 * English so the drill is exercised by typical words.
	 */
	const FALLBACK_TARGETS = ['th', 'he', 'in', 'er', 'an'] as const;

	/**
	 * Assumed baseline when no diagnostic has ever run. Graduation uses
	 * 60% of this for acquisition/hasty-style pacing (spec §4.1); real
	 * drills will read baseline from the progress store.
	 */
	const DEFAULT_BASELINE_WPM = 60;
	const PHASE_WPM = DEFAULT_BASELINE_WPM * 0.6;

	type LoadState =
		| { status: 'loading' }
		| { status: 'ready'; text: string; targets: readonly string[] }
		| { status: 'error'; message: string };

	let state = $state<LoadState>({ status: 'loading' });

	onMount(async () => {
		try {
			const planned = consumePlannedSession('bigram-drill');
			const targets =
				planned?.config.bigramsTargeted && planned.config.bigramsTargeted.length > 0
					? planned.config.bigramsTargeted
					: (FALLBACK_TARGETS as readonly string[]);
			const wordBudget = planned?.config.wordBudget ?? DEFAULT_BIGRAM_DRILL_WORD_BUDGET;

			const corpus = await loadBuiltinCorpus('en-top-1000');
			const seq = generateBigramDrillSequence({
				targetBigrams: targets,
				corpus,
				options: { wordCount: wordBudget }
			});
			state = { status: 'ready', text: seq.text, targets };
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
		targetBigrams={state.targets}
		graduationTargetMs={phaseTargetMsFromWPM(PHASE_WPM)}
	/>
{/if}
