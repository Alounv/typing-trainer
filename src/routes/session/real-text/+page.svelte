<script lang="ts">
	/**
	 * Real-text session route. Loads quote bank + fallback corpus, generates a
	 * passage sized to the planned word budget. Self-contained mini-workout.
	 */
	import { onMount } from 'svelte';
	import SessionShell from '$lib/session/components/SessionShell.svelte';
	import {
		loadBuiltinCorpus,
		loadQuoteBank,
		isBuiltinCorpusId,
		hasQuoteBank
	} from '$lib/corpus/registry';
	import { generateRealTextSequence } from '$lib/drill/real-text';
	import { consumePlannedSession } from '$lib/scheduler/handoff';
	import { getProfile } from '$lib/storage/service';
	import { DEFAULT_REAL_TEXT_WORD_BUDGET } from '$lib/models';

	/** 5 chars ≈ 1 word. Used to size text from a word budget. */
	const CHARS_PER_WORD = 5;

	/** Corpus used when the profile is absent or its id isn't a known built-in. */
	const FALLBACK_CORPUS_ID = 'en';

	type LoadState =
		| { status: 'loading' }
		| { status: 'ready'; text: string }
		| { status: 'error'; message: string };

	let state = $state<LoadState>({ status: 'loading' });

	onMount(async () => {
		try {
			// Dashboard hand-off: the scheduler chooses the word budget for
			// a planned session. Corpus + quote bank always come from the
			// profile (even for planned sessions) so a French user gets
			// French prose regardless of how they kicked off the session.
			const planned = consumePlannedSession('real-text');
			const profile = await getProfile();
			const wordBudget =
				planned?.config.wordBudget ??
				profile?.wordBudgets?.realText ??
				DEFAULT_REAL_TEXT_WORD_BUDGET;
			const targetChars = wordBudget * CHARS_PER_WORD;
			const pickedCorpusId = profile?.corpusIds?.[0];
			const corpusId =
				pickedCorpusId && isBuiltinCorpusId(pickedCorpusId) ? pickedCorpusId : FALLBACK_CORPUS_ID;
			const language = profile?.languages?.[0] ?? 'en';

			// Quote bank is the primary source; corpus is the synth fallback
			// when the bank runs out of quotes before hitting target chars.
			// The bank is optional — an unsupported language drops through
			// to synth-only, which still produces valid text.
			const [bank, corpus] = await Promise.all([
				hasQuoteBank(language) ? loadQuoteBank(language) : Promise.resolve(undefined),
				loadBuiltinCorpus(corpusId)
			]);
			const seq = generateRealTextSequence({
				quoteBank: bank,
				fallbackCorpus: corpus,
				options: { targetLengthChars: targetChars }
			});
			state = { status: 'ready', text: seq.text };
		} catch (err) {
			state = {
				status: 'error',
				message: err instanceof Error ? err.message : 'Failed to build passage.'
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
		type="real-text"
		text={state.text}
		title="Real text"
		what="Literary prose in your language, drawn from the quote bank. Real sentence structure, real punctuation, real rhythm."
		approach="Where drill precision becomes typing flow. Keep moving; errors are recorded but never blocking."
	/>
{/if}
