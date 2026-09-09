<script lang="ts">
	/**
	 * A real (visually-hidden) `<input>` takes the focus, so input arrives as
	 * `beforeinput` — `capture.ts` says why that matters.
	 *
	 * The per-character rendering is `aria-hidden` and the input carries the
	 * whole text as its `aria-label`, so a screen reader announces the passage
	 * once instead of 100+ separate characters.
	 */
	import TextDisplay from './TextDisplay.svelte';
	import { keystrokeCapture, type CaptureCallbacks } from '../capture';
	import { highlightVarForMode, type DifficultyMode } from '../tint';

	interface Props {
		text: string;
		/** Exposed bindable cursor — parent can mirror it into stats, progress, etc. */
		position?: number;
		errorPositions?: ReadonlySet<number>;
		correctedPositions?: ReadonlySet<number>;
		/** Per-bigram difficulty in [0, 1]; `null` disables the tint. */
		difficultyMap?: Map<string, number> | null;
		/** Which tint is active — picks the color the gradient lerps toward. */
		difficultyMode?: DifficultyMode | null;
		onEvent?: CaptureCallbacks['onEvent'];
	}

	let {
		text,
		position = $bindable(0),
		errorPositions,
		correctedPositions,
		difficultyMap = null,
		difficultyMode = null,
		onEvent
	}: Props = $props();

	function handlePosition(p: number) {
		position = p;
	}

	// Attachment-based auto-focus — cleaner than `bind:this` + $effect since
	// it colocates the DOM reference and the side effect.
	function focusOnMount(node: HTMLElement) {
		node.focus();
	}
</script>

<label
	class="block cursor-text rounded-lg bg-base-200 p-6 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary"
>
	<!-- aria-hidden: the input's aria-label carries the full text; we don't
	     want a screen reader to announce 100+ per-character spans. -->
	<div aria-hidden="true">
		<TextDisplay
			{text}
			{position}
			{errorPositions}
			{correctedPositions}
			bigramDifficultyMap={difficultyMap}
			difficultyHighlightVar={difficultyMode ? highlightVarForMode(difficultyMode) : null}
		/>
	</div>

	<!--
		The real input. `sr-only` keeps it visually hidden but focusable and
		still triggers the soft keyboard on mobile. All OS-level "helpfulness"
		(autocapitalize, autocorrect, autocomplete, spellcheck) is disabled —
		a typing trainer must receive exactly what the user typed, unmodified.
	-->
	<input
		type="text"
		class="sr-only"
		aria-label={text}
		aria-multiline="true"
		aria-readonly="false"
		autocapitalize="off"
		autocomplete="off"
		autocorrect="off"
		spellcheck="false"
		{@attach focusOnMount}
		{@attach keystrokeCapture({ text }, { onEvent, onPositionChange: handlePosition })}
	/>
</label>
