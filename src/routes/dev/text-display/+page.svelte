<script lang="ts">
	/**
	 * Throwaway preview for TypingSurface + Pacer (Phase 2.2–2.4).
	 * Remove when the walking skeleton (Phase 2.5) lands.
	 */
	import TypingSurface from '$lib/typing/TypingSurface.svelte';
	import Pacer from '$lib/typing/Pacer.svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import type { KeystrokeEvent } from '$lib/typing/types';

	const TEXT =
		'The quick brown fox jumps over the lazy dog. Typing trainers improve speed and accuracy through deliberate practice.';
	const TARGET_WPM = 60;

	let position = $state(0);
	const errorPositions = new SvelteSet<number>();
	const correctedPositions = new SvelteSet<number>();
	let completed = $state(false);
	// Pacer starts once the first keystroke lands — gives the user a beat to
	// read the first word before the clock ticks.
	let running = $state(false);
	let ghostPosition = $state(0);
	let announceErrors = $state(false);

	function onEvent(e: KeystrokeEvent) {
		running = true;
		if (e.actual !== e.expected) {
			errorPositions.add(e.position);
		} else if (errorPositions.has(e.position)) {
			// Retype matches expected at a previously-wrong position — the error
			// stays on the record (spec §2.2) but is now flagged as corrected.
			correctedPositions.add(e.position);
		}
	}
</script>

<div class="mx-auto max-w-3xl space-y-6 p-8">
	<header class="space-y-1">
		<h1 class="text-2xl font-bold">TypingSurface — dev preview</h1>
		<p class="text-sm text-base-content/70">
			Focus the box (auto-focused on load) and type. Uncorrected wrong characters highlight red;
			corrected ones keep a subtle amber dotted underline; the pink highlight is the pacer ghost.
		</p>
	</header>

	<TypingSurface
		text={TEXT}
		bind:position
		{errorPositions}
		{correctedPositions}
		{ghostPosition}
		{announceErrors}
		{onEvent}
		onComplete={() => {
			completed = true;
		}}
	/>

	<div class="flex flex-wrap items-center gap-4 text-sm">
		<span>Position: <strong>{position}</strong> / {TEXT.length}</span>
		<span>Errors: <strong>{errorPositions.size}</strong></span>
		<Pacer
			targetWPM={TARGET_WPM}
			{position}
			textLength={TEXT.length}
			running={running && !completed}
			bind:ghostPosition
		/>
		<label class="flex cursor-pointer items-center gap-2">
			<input type="checkbox" class="toggle toggle-sm" bind:checked={announceErrors} />
			Announce errors (SR)
		</label>
		{#if completed}
			<span class="font-medium text-success">✓ Completed</span>
		{/if}
		<button class="btn ml-auto btn-sm" onclick={() => window.location.reload()}>Reload</button>
	</div>
</div>
