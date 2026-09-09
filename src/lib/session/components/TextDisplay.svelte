<script lang="ts">
	/** Presentational only — the parent owns `position` and `errorPositions`. */
	import { difficultyToColor } from '../tint';

	type CharState =
		| 'typed-correct'
		| 'typed-error'
		| 'typed-error-corrected'
		| 'current'
		| 'pending';

	interface Props {
		text: string;
		/** Next character to be typed; the cursor sits here. */
		position: number;
		/** First input was wrong. A later correction does not clear it. */
		errorPositions?: ReadonlySet<number>;
		/** Subset of `errorPositions` where the user later typed the correct char. */
		correctedPositions?: ReadonlySet<number>;
		/** Per-bigram difficulty score in [0, 1]; tints pending letters by the incoming bigram. */
		bigramDifficultyMap?: Map<string, number> | null;
		/** DaisyUI CSS variable name the difficulty gradient lerps toward (e.g. `--color-warning`). */
		difficultyHighlightVar?: string | null;
	}

	let {
		text,
		position,
		errorPositions = new Set<number>(),
		correctedPositions = new Set<number>(),
		bigramDifficultyMap = null,
		difficultyHighlightVar = null
	}: Props = $props();

	// Deliberately not a $derived array of char descriptors: on a 2k-char text
	// that allocates N objects and re-diffs the each-block every keystroke. The
	// template iterates `text` and calls `stateFor()` inline instead, so only
	// the class expressions re-run.

	function stateFor(
		i: number,
		pos: number,
		errors: ReadonlySet<number>,
		corrected: ReadonlySet<number>
	): CharState {
		if (i === pos) return 'current';
		if (i > pos) return 'pending';
		if (!errors.has(i)) return 'typed-correct';
		return corrected.has(i) ? 'typed-error-corrected' : 'typed-error';
	}

	const stateClasses: Record<CharState, string> = {
		pending: 'text-base-content/45',
		'typed-correct': 'text-base-content/75',
		// Uncorrected error: solid red tint — the mistake is still standing.
		'typed-error': 'text-error-content bg-error/30 rounded-sm',
		// Corrected: reads as typed-correct, with a dotted underline for the stumble.
		'typed-error-corrected':
			'text-base-content/75 underline decoration-dotted decoration-warning underline-offset-4',
		// Text-only inversion; `cursorRect` draws the block behind it, so the
		// cursor slides between keystrokes instead of jumping class to class.
		current: 'text-primary-content'
	};

	/**
	 * Clipped to six lines so a few thousand characters do not present as a
	 * wall. The container scrolls, not the document, so the header stays put.
	 */
	let viewportEl: HTMLDivElement | null = $state(null);

	/**
	 * Same-line keystrokes leave `offsetTop` unchanged, so comparing against it
	 * fires `scrollTo` exactly once per line rather than once per character.
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
<!--
	Two-layer structure. The outer viewport owns scrolling + `position: relative`
	for the absolutely-positioned cursor overlay. The inner `text-flow` div
	owns `whitespace-pre-wrap` so only the per-character spans sit in a
	whitespace-preserving context — otherwise Svelte's compiled whitespace
	text node between the cursor `<div>` and the first span renders as a
	visible leading space at the start of every drill.
-->
<div
	bind:this={viewportEl}
	class="relative max-h-[18rem] overflow-y-hidden font-mono text-2xl leading-loose tracking-wide break-normal"
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

	<div class="whitespace-pre-wrap">
		{#each text as char, i (i)}
			{@const state = stateFor(i, position, errorPositions, correctedPositions)}
			{@const difficultyScore =
				state === 'pending' && i > 0 && bigramDifficultyMap && difficultyHighlightVar
					? (bigramDifficultyMap.get(text[i - 1] + char) ?? null)
					: null}
			<span
				class="relative transition-colors duration-75 motion-reduce:transition-none {stateClasses[
					state
				]}"
				style={difficultyScore !== null && difficultyHighlightVar
					? `color: ${difficultyToColor(difficultyScore, difficultyHighlightVar)}`
					: ''}
				data-state={state}
				data-pos={i}
				data-difficulty={difficultyScore !== null ? difficultyScore.toFixed(3) : null}>{char}</span
			>
		{/each}
	</div>
</div>
