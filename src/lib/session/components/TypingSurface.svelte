<script lang="ts">
	/**
	 * Focusable typing surface. A `<label>` wraps the decorative text
	 * rendering and a visually-hidden `<input>` that actually receives focus
	 * and input events.
	 *
	 * Why a hidden input (not `keydown` on a div): the browser's input
	 * pipeline resolves dead-key composition (`^` + `o` → `ô`), IME, and
	 * OS editing shortcuts (OPT+Backspace = delete word) into semantic
	 * `beforeinput` events. `keydown` only sees raw physical keys and
	 * misses composed characters entirely.
	 *
	 * A11y: the input carries the full text as its `aria-label`, so screen
	 * readers announce "textbox, <text>" on focus. The visual per-character
	 * rendering is purely decorative and hidden via `aria-hidden` so SR
	 * users aren't bombarded with 100+ character announcements. Clicking
	 * anywhere on the label forwards focus to the input (native label
	 * behavior).
	 */
	import TextDisplay from './TextDisplay.svelte';
	import { keystrokeCapture, type CaptureCallbacks } from '../capture';
	import type { KeystrokeEvent } from '../../support/core';

	interface Props {
		text: string;
		/** Exposed bindable cursor — parent can mirror it into Pacer, stats, etc. */
		position?: number;
		errorPositions?: ReadonlySet<number>;
		correctedPositions?: ReadonlySet<number>;
		ghostPosition?: number;
		/** Forwarded to TextDisplay so the ghost overlay's CSS slide matches the pace. */
		ghostTransitionMs?: number;
		/** Forwarded to TextDisplay; highlights pending chars inside target bigrams. */
		targetBigrams?: readonly string[];
		/** Auto-focus the surface on mount. Default: true. */
		autoFocus?: boolean;
		/**
		 * Opt-in: announce wrong keystrokes via an ARIA live region. Off by
		 * default — announcements during timed drills are disruptive for
		 * most users, including SR users who are practicing speed.
		 */
		announceErrors?: boolean;
		onEvent?: CaptureCallbacks['onEvent'];
		onComplete?: CaptureCallbacks['onComplete'];
	}

	let {
		text,
		position = $bindable(0),
		errorPositions,
		correctedPositions,
		ghostPosition,
		ghostTransitionMs,
		targetBigrams,
		autoFocus = true,
		announceErrors = false,
		onEvent,
		onComplete
	}: Props = $props();

	let liveMessage = $state('');

	function handleEvent(e: KeystrokeEvent) {
		if (announceErrors && e.actual !== e.expected) {
			liveMessage = `Expected ${e.expected}, typed ${e.actual}`;
		}
		onEvent?.(e);
	}

	function handlePosition(p: number) {
		position = p;
	}

	// Attachment-based auto-focus — cleaner than `bind:this` + $effect since
	// it colocates the DOM reference and the side effect.
	function focusOnMount(node: HTMLElement) {
		if (autoFocus) node.focus();
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
			{ghostPosition}
			{ghostTransitionMs}
			{targetBigrams}
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
		{@attach keystrokeCapture(
			{ text },
			{ onEvent: handleEvent, onPositionChange: handlePosition, onComplete }
		)}
	/>
</label>

<!-- Visually hidden live region. Populated only when `announceErrors` is true. -->
<div role="status" aria-live="polite" class="sr-only">{liveMessage}</div>
