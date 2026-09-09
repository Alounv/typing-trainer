<script lang="ts">
	/**
	 * The session route. Picks a passage from the quote bank by how much of the
	 * typist's outstanding bigram debt it can repay.
	 */
	import SessionShell from '$lib/session/components/SessionShell.svelte';
	import { loadable } from '$lib/support/loadable.svelte';
	import { prepareRealTextSession } from './loader';

	const passage = loadable(prepareRealTextSession, 'Failed to build passage.');
</script>

{#if passage.current.status === 'loading'}
	<p class="mx-auto max-w-3xl text-base-content/70">Loading passage…</p>
{:else if passage.current.status === 'error'}
	<p class="mx-auto max-w-3xl text-error" role="alert">{passage.current.message}</p>
{:else}
	<SessionShell
		text={passage.current.data.text}
		title="Real text"
		approach="Push until errors show, then hold there — 5% is the ceiling. Keep moving; nothing here blocks you, and the verdict comes at the end."
	/>
{/if}
