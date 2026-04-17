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

<div class="mx-auto max-w-3xl space-y-8">
	<header class="space-y-2">
		<h1 class="text-4xl font-bold tracking-tight">Diagnostic</h1>
		<p class="text-base-content/70">
			Type the passage below. Errors are recorded but not blocked — just keep going.
		</p>
	</header>

	<!--
		Ambient progress: a hairline bar above the drill replaces the old
		"Position: X / Y" debug readout. Visible but non-demanding — the user
		focuses on the text, the bar drifts in peripheral vision. Width is
		driven by `position / TEXT.length`; `aria-valuenow` is the integer
		percent so assistive tech gets a meaningful progress announcement
		without re-announcing on every keystroke.
	-->
	<div class="space-y-3">
		<div
			class="h-0.5 w-full overflow-hidden rounded-full bg-base-300"
			role="progressbar"
			aria-label="Session progress"
			aria-valuemin="0"
			aria-valuemax="100"
			aria-valuenow={Math.round((position / TEXT.length) * 100)}
		>
			<div
				class="h-full bg-primary transition-[width] duration-75 ease-out motion-reduce:transition-none"
				style="width: {(position / TEXT.length) * 100}%"
			></div>
		</div>

		<TypingSurface
			text={TEXT}
			bind:position
			{errorPositions}
			{correctedPositions}
			{onEvent}
			{onComplete}
		/>
	</div>

	<!-- Transient state only: save progress and save errors. The live error
	     count has been dropped — the red/amber char highlights already show
	     errors in place, counting them mid-session added pressure without
	     insight. -->
	{#if saving || saveError}
		<div class="text-sm" aria-live="polite">
			{#if saving}
				<span class="text-base-content/70">Saving…</span>
			{/if}
			{#if saveError}
				<span class="text-error" role="alert">{saveError}</span>
			{/if}
		</div>
	{/if}
</div>
