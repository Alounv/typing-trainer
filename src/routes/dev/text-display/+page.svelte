<script lang="ts">
	/**
	 * Throwaway preview for TextDisplay (Phase 2.2). Wires capture + display
	 * together so the four per-character states (pending / current /
	 * typed-correct / typed-error) are visible during actual typing.
	 *
	 * Remove when the walking skeleton (Phase 2.5) lands.
	 */
	import TextDisplay from '$lib/typing/TextDisplay.svelte';
	import Pacer from '$lib/typing/Pacer.svelte';
	import { keystrokeCapture } from '$lib/typing/capture';
	import { SvelteSet } from 'svelte/reactivity';

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

	function onEvent(e: { position: number; expected: string; actual: string }) {
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
		<h1 class="text-2xl font-bold">TextDisplay — dev preview</h1>
		<p class="text-sm text-base-content/70">
			Click the box below and type. Wrong characters highlight red; the cursor sits on the next
			expected character.
		</p>
	</header>

	<!-- role="textbox" turns this into an interactive region so tabindex is valid
	     and screen readers treat it as an input. A proper label comes in Phase 2.4. -->
	<div
		role="textbox"
		tabindex="0"
		aria-label="Drill typing surface"
		class="rounded-lg bg-base-200 p-6 focus:outline-2 focus:outline-offset-2 focus:outline-primary"
		{@attach keystrokeCapture(
			{ text: TEXT },
			{
				onPositionChange: (p) => {
					position = p;
				},
				onEvent,
				onComplete: () => {
					completed = true;
				}
			}
		)}
	>
		<TextDisplay text={TEXT} {position} {errorPositions} {correctedPositions} {ghostPosition} />
	</div>

	<div class="flex items-center gap-4 text-sm">
		<span>Position: <strong>{position}</strong> / {TEXT.length}</span>
		<span>Errors: <strong>{errorPositions.size}</strong></span>
		<Pacer
			targetWPM={TARGET_WPM}
			{position}
			textLength={TEXT.length}
			running={running && !completed}
			bind:ghostPosition
		/>
		{#if completed}
			<span class="font-medium text-success">✓ Completed</span>
		{/if}
		<button class="btn ml-auto btn-sm" onclick={() => (window.location.href = window.location.href)}
			>Reload</button
		>
	</div>
</div>
