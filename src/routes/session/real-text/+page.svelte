<script lang="ts">
	/**
	 * Real-text session route. Loads the English quote bank + fallback
	 * corpus, generates a passage sized to ~10 minutes at the assumed
	 * baseline WPM. Once a real baseline is stored (Phase 10), swap the
	 * constant for a read from the progress store.
	 */
	import { onMount } from 'svelte';
	import SessionShell from '$lib/session/components/SessionShell.svelte';
	import { loadBuiltinCorpus, loadQuoteBank } from '$lib/corpus/registry';
	import { generateRealTextSequence } from '$lib/drill/real-text';

	const DEFAULT_BASELINE_WPM = 60;
	const TARGET_MINUTES = 10;
	/**
	 * 5 chars = 1 word (spec). Text length = wordsPerMin × minutes × 5.
	 * At 60 WPM × 10 min → 3000 chars, which is ~15-25 typical quotes.
	 */
	const TARGET_CHARS = DEFAULT_BASELINE_WPM * TARGET_MINUTES * 5;

	type LoadState =
		| { status: 'loading' }
		| { status: 'ready'; text: string }
		| { status: 'error'; message: string };

	let state = $state<LoadState>({ status: 'loading' });

	onMount(async () => {
		try {
			// Quote bank is the primary source; corpus is the synth fallback
			// when the bank runs out of quotes before hitting target chars.
			const [bank, corpus] = await Promise.all([
				loadQuoteBank('en'),
				loadBuiltinCorpus('en-top-1000')
			]);
			const seq = generateRealTextSequence({
				quoteBank: bank,
				fallbackCorpus: corpus,
				options: { targetLengthChars: TARGET_CHARS }
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
		lede="Paced reading of real prose. No stop-on-error — type through it."
	/>
{/if}
