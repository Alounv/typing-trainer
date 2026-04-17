<script lang="ts">
	/**
	 * Walking-skeleton diagnostic session (Phase 2.5). A single hardcoded
	 * passage, captured via TypingSurface, summarized by the session runner,
	 * persisted through the storage service, then we hop to the summary page.
	 *
	 * No corpus, no pacer, no branching — the point is to prove the loop
	 * composes end-to-end before Phase 3+ piles on.
	 */
	import { goto } from '$app/navigation';
	import { SvelteSet } from 'svelte/reactivity';
	import TypingSurface from '$lib/typing/TypingSurface.svelte';
	import type { KeystrokeEvent } from '$lib/typing/types';
	import { buildSessionSummary } from '$lib/session/runner';
	import { saveSession } from '$lib/storage/service';

	// Hardcoded passage for v0.1 (spec §2.5.1). Short enough to finish in well
	// under a minute; mixes common bigrams so extraction has something real
	// to chew on.
	const TEXT =
		'The quick brown fox jumps over the lazy dog. Typing trainers improve speed and accuracy through deliberate practice.';

	let position = $state(0);
	const errorPositions = new SvelteSet<number>();
	const correctedPositions = new SvelteSet<number>();

	// `performance.now()` anchor captured on the first keystroke rather than
	// on mount, so reading/focus time doesn't pollute the WPM denominator.
	let sessionStart: number | null = null;
	let saving = $state(false);
	let saveError = $state<string | null>(null);

	function onEvent(e: KeystrokeEvent) {
		if (sessionStart === null) sessionStart = performance.now();
		if (e.actual !== e.expected) {
			errorPositions.add(e.position);
		} else if (errorPositions.has(e.position)) {
			correctedPositions.add(e.position);
		}
	}

	async function onComplete(events: readonly KeystrokeEvent[]) {
		// Guard: `onComplete` only fires when the full text is typed, so
		// sessionStart is always set here — but fail loud if that changes.
		if (sessionStart === null) {
			saveError = 'Internal error: session start not recorded.';
			return;
		}
		saving = true;
		const durationMs = performance.now() - sessionStart;
		const summary = buildSessionSummary({
			events,
			type: 'diagnostic',
			textLength: TEXT.length,
			durationMs
		});
		try {
			await saveSession(summary);
			await goto(`/session/${summary.id}/summary`);
		} catch (err) {
			saving = false;
			saveError = err instanceof Error ? err.message : 'Failed to save session.';
		}
	}
</script>

<div class="mx-auto max-w-3xl space-y-6">
	<header class="space-y-1">
		<h1 class="text-3xl font-bold">Diagnostic</h1>
		<p class="text-base-content/70">
			Type the passage below. Errors are recorded but not blocked — just keep going.
		</p>
	</header>

	<TypingSurface
		text={TEXT}
		bind:position
		{errorPositions}
		{correctedPositions}
		{onEvent}
		{onComplete}
	/>

	<div class="flex items-center gap-4 text-sm">
		<span>Position: <strong>{position}</strong> / {TEXT.length}</span>
		<span>Errors: <strong>{errorPositions.size}</strong></span>
		{#if saving}
			<span class="text-base-content/70">Saving…</span>
		{/if}
		{#if saveError}
			<span class="text-error" role="alert">{saveError}</span>
		{/if}
	</div>
</div>
