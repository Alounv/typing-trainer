<script lang="ts">
	/**
	 * Diagnostic session route. Generates a passage sized for spec §2.5
	 * (~500–800 keystrokes) that biases toward the top-50 corpus bigrams
	 * so the downstream report has enough observations to classify each.
	 *
	 * Shell-driven: raw events persisted so thresholds can be replayed
	 * later (spec §2.8).
	 */
	import { onMount } from 'svelte';
	import SessionShell from '$lib/session/components/SessionShell.svelte';
	import { loadBuiltinCorpus, isBuiltinCorpusId } from '$lib/corpus/registry';
	import { sampleDiagnosticPassage } from '$lib/diagnostic/sampler';
	import { getProfile } from '$lib/storage/service';
	import { DEFAULT_DIAGNOSTIC_WORD_BUDGET } from '$lib/models';

	/** 5 chars ≈ 1 word (spec §2.3) — translates the user's word budget into the sampler's char target. */
	const CHARS_PER_WORD = 5;

	/**
	 * Corpus used when the user has no stored profile or their stored id
	 * doesn't match any built-in (e.g. a migration or a removed corpus).
	 */
	const FALLBACK_CORPUS_ID = 'en-top-1000';

	type LoadState =
		| { status: 'loading' }
		| { status: 'ready'; text: string }
		| { status: 'error'; message: string };

	let state = $state<LoadState>({ status: 'loading' });

	onMount(async () => {
		try {
			// Use the synth path (no quote bank): the target-bigram boost
			// lives in `selectRealTextSentence`, and the diagnostic wants
			// coverage more than literary naturalness. Word budget and
			// corpus both come from the profile — a French-primary user
			// gets a French diagnostic, for example. Unknown ids fall
			// back to English rather than throwing mid-route.
			const profile = await getProfile();
			const pickedId = profile?.corpusIds?.[0];
			const corpusId = pickedId && isBuiltinCorpusId(pickedId) ? pickedId : FALLBACK_CORPUS_ID;
			const corpus = await loadBuiltinCorpus(corpusId);
			const wordBudget = profile?.wordBudgets?.diagnostic ?? DEFAULT_DIAGNOSTIC_WORD_BUDGET;
			const passage = sampleDiagnosticPassage(corpus, {
				targetChars: wordBudget * CHARS_PER_WORD
			});
			state = { status: 'ready', text: passage.text };
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
	<SessionShell
		type="diagnostic"
		text={state.text}
		title="Diagnostic"
		lede="Type the passage below. Errors are recorded but not blocked — just keep going."
		persistRawEvents
	/>
{/if}
