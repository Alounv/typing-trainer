<script lang="ts">
	/**
	 * Focusable typing surface: a textbox-role container that owns the
	 * capture attachment, renders the text via TextDisplay, and handles
	 * accessibility (aria-label, aria-hidden on visual innards, opt-in
	 * live region for errors).
	 *
	 * Why `role="textbox"` + `aria-multiline="true"`: screen readers
	 * announce "textbox, <text>" on focus, which is the natural mental
	 * model for a typing drill. The visual per-character rendering is
	 * purely decorative and hidden via `aria-hidden` so SR users aren't
	 * bombarded with 100+ character announcements.
	 */
	import TextDisplay from './TextDisplay.svelte';
	import { keystrokeCapture, type CaptureCallbacks } from './capture';
	import type { KeystrokeEvent } from './types';

	interface Props {
		text: string;
		/** Exposed bindable cursor — parent can mirror it into Pacer, stats, etc. */
		position?: number;
		errorPositions?: ReadonlySet<number>;
		correctedPositions?: ReadonlySet<number>;
		ghostPosition?: number;
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

<div
	role="textbox"
	tabindex="0"
	aria-label={text}
	aria-multiline="true"
	aria-readonly="false"
	class="rounded-lg bg-base-200 p-6 focus:outline-2 focus:outline-offset-2 focus:outline-primary"
	{@attach focusOnMount}
	{@attach keystrokeCapture(
		{ text },
		{ onEvent: handleEvent, onPositionChange: handlePosition, onComplete }
	)}
>
	<!-- aria-hidden: the parent's aria-label carries the full text; we don't
	     want a screen reader to announce 100+ per-character spans. -->
	<div aria-hidden="true">
		<TextDisplay {text} {position} {errorPositions} {correctedPositions} {ghostPosition} />
	</div>
</div>

<!-- Visually hidden live region. Populated only when `announceErrors` is true. -->
<div role="status" aria-live="polite" class="sr-only">{liveMessage}</div>
