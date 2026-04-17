<script lang="ts">
	/**
	 * Renders the drill text with per-character state: typed-correct /
	 * typed-error / current / pending. Purely presentational — the parent
	 * owns `position` and `errorPositions` and updates them from capture
	 * callbacks.
	 *
	 * Wrapping: uses `whitespace-pre-wrap` so the browser breaks lines at
	 * natural spaces. Drill sentences are short enough that mid-word breaks
	 * don't occur in practice.
	 */
	type CharState =
		| 'typed-correct'
		| 'typed-error'
		| 'typed-error-corrected'
		| 'current'
		| 'pending';

	interface Props {
		text: string;
		/** Index of the next character to be typed (cursor sits here). */
		position: number;
		/** Positions whose first-input was wrong (first-input sticks). */
		errorPositions?: ReadonlySet<number>;
		/** Subset of `errorPositions` where the user later typed the correct char. */
		correctedPositions?: ReadonlySet<number>;
		/**
		 * Optional pacer ghost position. When set and strictly ahead of
		 * `position`, the char at that index gets a secondary highlight
		 * marking "where the pacer expects you to be".
		 */
		ghostPosition?: number;
	}

	let {
		text,
		position,
		errorPositions = new Set<number>(),
		correctedPositions = new Set<number>(),
		ghostPosition
	}: Props = $props();

	// Per-keystroke hot path: we deliberately do NOT build a $derived array
	// of char descriptors here. On long texts (e.g. 2k+ chars) that would
	// allocate N objects and force Svelte's each-block to re-diff every
	// keystroke. Instead, the template iterates `text` directly and calls
	// `stateFor()` / ghost-check inline — Svelte's fine-grained reactivity
	// then re-runs only the class expressions, with no N-wide allocation.

	function stateFor(
		i: number,
		pos: number,
		errors: ReadonlySet<number>,
		corrected: ReadonlySet<number>
	): CharState {
		if (i === pos) return 'current';
		if (i < pos) {
			if (!errors.has(i)) return 'typed-correct';
			return corrected.has(i) ? 'typed-error-corrected' : 'typed-error';
		}
		return 'pending';
	}

	// DaisyUI semantic colors keep the drill readable across any active theme.
	const stateClasses: Record<CharState, string> = {
		pending: 'text-base-content/45',
		'typed-correct': 'text-base-content/75',
		// Uncorrected error: solid red tint — the mistake is still standing.
		'typed-error': 'text-error-content bg-error/30 rounded-sm',
		// Corrected error: reads like typed-correct with a thin dotted amber
		// underline marking the stumble. Recovery, not punishment.
		'typed-error-corrected':
			'text-base-content/75 underline decoration-dotted decoration-warning underline-offset-4',
		// Current char: text-only inversion. The saturated primary block
		// behind it is drawn by the animated cursor overlay below (see
		// `cursorRect`) so motion between keystrokes is a lateral slide
		// rather than a discrete class swap.
		current: 'text-primary-content'
	};

	/**
	 * Windowed viewport: drill text is clipped to exactly 6 lines and
	 * line-locked-scrolled so the current line stays near the top. Keeps
	 * long sessions (real-text, several thousand chars) from presenting
	 * as a wall; short drills (diagnostic) fit inside the cap and render
	 * naturally.
	 *
	 * We scroll the container, not the document, so the header and
	 * stats row stay fixed in view.
	 */
	let viewportEl: HTMLDivElement | null = $state(null);

	/**
	 * `offsetTop` of the span on the last scroll decision. Same-line
	 * keystrokes don't shift offsetTop (the browser only wraps on word
	 * boundaries), so the skip avoids re-issuing `scrollTo` with the
	 * same target on every char. Scroll fires exactly once per line.
	 */
	let lastLineTop = -1;

	/**
	 * Cursor bar geometry in viewport-local coordinates. A CSS-transition
	 * on `transform` slides the bar laterally as `position` advances,
	 * which reads much calmer than swapping a background class between
	 * discrete spans (the previous approach jumped character-to-character
	 * and felt abrupt).
	 */
	let cursorRect = $state({ x: 0, y: 0, w: 0, h: 0, ready: false });

	$effect(() => {
		// Re-run when position changes. Relies on the viewport being
		// `position: relative` so the span's `offsetTop` is measured from
		// the viewport itself (not whatever ancestor happens to be
		// positioned).
		if (!viewportEl) return;
		// `getElementsByTagName` returns a live collection of spans,
		// skipping the absolutely-positioned cursor overlay element —
		// that's why we can't just index into `viewportEl.children` any
		// more. Still O(1) on access after the initial layout.
		const spans = viewportEl.getElementsByTagName('span');
		const currentSpan = spans[position] as HTMLElement | undefined;
		if (!currentSpan) return;

		// Update cursor rect every tick so the animated bar follows the
		// current character exactly. The transition lives in the template
		// `style` binding — the only thing to do here is push the target.
		cursorRect = {
			x: currentSpan.offsetLeft,
			y: currentSpan.offsetTop,
			w: currentSpan.offsetWidth,
			h: currentSpan.offsetHeight,
			ready: true
		};

		const lineTop = currentSpan.offsetTop;
		if (lineTop === lastLineTop) return;
		lastLineTop = lineTop;

		viewportEl.scrollTo({
			top: lineTop,
			behavior: prefersReducedMotion() ? 'instant' : 'smooth'
		});
	});

	/**
	 * Respect `prefers-reduced-motion`. Smooth scrolling on every line
	 * change can feel queasy for motion-sensitive users. Checked at call
	 * time so an OS setting toggle mid-session is honored without reload.
	 */
	function prefersReducedMotion(): boolean {
		if (typeof window === 'undefined') return false;
		return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	}
</script>

<!--
	Viewport height snaps to an exact line count so nothing gets clipped
	mid-character. At `text-2xl` (1.5rem) × `leading-loose` (2) each line
	is 3rem tall; 6 lines = 18rem. Change the line count here if the
	type scale ever changes. `overflow-y-hidden` hides the scrollbar;
	programmatic `scrollTo` still works in modern browsers.
-->
<div
	bind:this={viewportEl}
	class="relative max-h-[18rem] overflow-y-hidden font-mono text-2xl leading-loose tracking-wide break-normal whitespace-pre-wrap"
	aria-label="Drill text"
>
	<!--
		Animated cursor bar. Positioned absolutely inside the viewport and
		translated via `transform` so the browser promotes it to its own
		compositor layer and the slide is GPU-accelerated. `opacity` guards
		against a one-frame flash at (0,0) before the first layout measure
		populates `cursorRect`.
	-->
	<div
		class="pointer-events-none absolute top-0 left-0 rounded-sm bg-primary/70 transition-[transform,width,height,opacity] duration-100 ease-out motion-reduce:transition-none"
		style="transform: translate({cursorRect.x}px, {cursorRect.y}px); width: {cursorRect.w}px; height: {cursorRect.h}px; opacity: {cursorRect.ready
			? 1
			: 0}"
		aria-hidden="true"
	></div>

	{#each text as char, i (i)}
		{@const state = stateFor(i, position, errorPositions, correctedPositions)}
		{@const ghost = ghostPosition !== undefined && i === ghostPosition && i > position}
		<span
			class="relative transition-colors duration-75 motion-reduce:transition-none {stateClasses[
				state
			]} {ghost ? 'rounded-sm border-b border-secondary/60 bg-secondary/15' : ''}"
			data-state={state}
			data-pos={i}
			data-ghost={ghost || undefined}>{char}</span
		>
	{/each}
</div>
