<script lang="ts">
	/**
	 * Real-text session route. Loads the English quote bank + fallback
	 * corpus, generates a passage sized to the planned word budget
	 * (spec §5). Rounds split the budget into intermediate milestones
	 * so a long session still has visible structure.
	 */
	import { onMount } from 'svelte';
	import SessionShell from '$lib/session/components/SessionShell.svelte';
	import { loadBuiltinCorpus, loadQuoteBank } from '$lib/corpus/registry';
	import { generateRealTextSequence, QUOTE_SEPARATOR } from '$lib/drill/real-text';
	import { consumePlannedSession } from '$lib/scheduler/handoff';
	import { computeRoundBoundaries } from '$lib/session/rounds';
	import { DEFAULT_REAL_TEXT_WORD_BUDGET, DEFAULT_ROUND_COUNT } from '$lib/models';

	/** 5 chars ≈ 1 word (spec §2.3). Used to size text from a word budget. */
	const CHARS_PER_WORD = 5;

	type LoadState =
		| { status: 'loading' }
		| { status: 'ready'; text: string; roundBoundaries: readonly number[]; roundCount: number }
		| { status: 'error'; message: string };

	let state = $state<LoadState>({ status: 'loading' });

	onMount(async () => {
		try {
			// Dashboard hand-off: the scheduler chooses word budget + round
			// count for planned sessions. Direct nav falls back to defaults.
			const planned = consumePlannedSession('real-text');
			const wordBudget = planned?.config.wordBudget ?? DEFAULT_REAL_TEXT_WORD_BUDGET;
			const roundCount = planned?.config.roundCount ?? DEFAULT_ROUND_COUNT;
			const targetChars = wordBudget * CHARS_PER_WORD;

			// Quote bank is the primary source; corpus is the synth fallback
			// when the bank runs out of quotes before hitting target chars.
			const [bank, corpus] = await Promise.all([
				loadQuoteBank('en'),
				loadBuiltinCorpus('en-top-1000')
			]);
			const seq = generateRealTextSequence({
				quoteBank: bank,
				fallbackCorpus: corpus,
				options: { targetLengthChars: targetChars }
			});
			const roundBoundaries = computeRoundBoundaries(
				seq.segments.map((s) => s.text.length),
				QUOTE_SEPARATOR.length,
				roundCount
			);
			state = { status: 'ready', text: seq.text, roundBoundaries, roundCount };
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
		lede="Paced reading of real prose. No stop-on-error — type through it."
		roundBoundaries={state.roundBoundaries}
		roundCount={state.roundCount}
	/>
{/if}
