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
	import {
		loadBuiltinCorpus,
		isBuiltinCorpusId,
		loadQuoteBank,
		hasQuoteBank
	} from '$lib/corpus/registry';
	import { sampleDiagnosticPassage } from '$lib/diagnostic/sampler';
	import { generateDiagnosticReport } from '$lib/diagnostic/engine';
	import type { FrequencyTable } from '$lib/corpus/types';
	import { getProfile } from '$lib/storage/service';
	import { DEFAULT_DIAGNOSTIC_WORD_BUDGET } from '$lib/models';

	/** 5 chars ≈ 1 word — translates word budget into the sampler's char target. */
	const CHARS_PER_WORD = 5;

	/**
	 * Corpus used when the user has no stored profile or their stored id
	 * doesn't match any built-in (e.g. a migration or a removed corpus).
	 */
	const FALLBACK_CORPUS_ID = 'en-top-1000';

	type LoadState =
		| { status: 'loading' }
		| { status: 'ready'; text: string; corpusBigramFrequencies: FrequencyTable }
		| { status: 'error'; message: string };

	let state = $state<LoadState>({ status: 'loading' });

	onMount(async () => {
		try {
			// Profile drives language/corpus; unknown ids fall back to English.
			const profile = await getProfile();
			const pickedId = profile?.corpusIds?.[0];
			const corpusId = pickedId && isBuiltinCorpusId(pickedId) ? pickedId : FALLBACK_CORPUS_ID;

			// Load the corpus (wordlist + language bigram table) and the quote
			// bank in parallel. The quote bank is optional — languages without
			// one fall through to synth-path word sampling inside the sampler.
			const corpus = await loadBuiltinCorpus(corpusId);
			const quoteBank = hasQuoteBank(corpus.config.language)
				? await loadQuoteBank(corpus.config.language)
				: undefined;

			const wordBudget = profile?.wordBudgets?.diagnostic ?? DEFAULT_DIAGNOSTIC_WORD_BUDGET;
			const passage = sampleDiagnosticPassage(corpus, {
				targetChars: wordBudget * CHARS_PER_WORD,
				quoteBank
			});
			state = {
				status: 'ready',
				text: passage.text,
				corpusBigramFrequencies: corpus.bigramFrequencies
			};
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
		lede="Type the passage below. Errors are recorded but not blocked — just keep going."
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
