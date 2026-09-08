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
	import { SvelteSet } from 'svelte/reactivity';
	import { difficultyToColor } from '../bigramDifficulty';

	type CharState =
		| 'typed-correct'
		| 'typed-error'
		| 'typed-error-corrected'
		| 'current'
		| 'pending'
		| 'target';

	interface Props {
		text: string;
		/** Index of the next character to be typed (cursor sits here). */
		position: number;
		/** Positions whose first-input was wrong (first-input sticks). */
		errorPositions?: ReadonlySet<number>;
		/** Subset of `errorPositions` where the user later typed the correct char. */
		correctedPositions?: ReadonlySet<number>;
		/**
		 * Bigrams to highlight as drill targets. Each character whose position
		 * starts or ends one of these bigrams renders in the `target` color
		 * while still pending; once typed it falls back to the normal
		 * correct/error states.
		 */
		targetBigrams?: readonly string[];
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
		targetBigrams,
		bigramDifficultyMap = null,
		difficultyHighlightVar = null
	}: Props = $props();

	const targetPositions = $derived.by(() => {
		const set = new SvelteSet<number>();

		if (!targetBigrams || targetBigrams.length === 0) return set;
		const targets = new Set(targetBigrams);
		for (let i = 0; i < text.length - 1; i++) {
			if (targets.has(text.slice(i, i + 2))) {
				set.add(i);
				set.add(i + 1);
			}
		}
		return set;
	});

	// Per-keystroke hot path: we deliberately do NOT build a $derived array
	// of char descriptors here. On long texts (e.g. 2k+ chars) that would
	// allocate N objects and force Svelte's each-block to re-diff every
	// keystroke. Instead, the template iterates `text` directly and calls
	// `stateFor()` inline — Svelte's fine-grained reactivity
	// then re-runs only the class expressions, with no N-wide allocation.

	function stateFor(
		i: number,
		pos: number,
		errors: ReadonlySet<number>,
		corrected: ReadonlySet<number>,
		targets: ReadonlySet<number>
	): CharState {
		if (i === pos) return 'current';
		if (i < pos) {
			if (!errors.has(i)) return 'typed-correct';
			return corrected.has(i) ? 'typed-error-corrected' : 'typed-error';
		}
		return targets.has(i) ? 'target' : 'pending';
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
		current: 'text-primary-content',
		// Pending char that is part of a target bigram — highlights the
		// transitions the drill is exercising. Cleared once the char is typed.
		target: 'text-accent'
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
			{@const state = stateFor(i, position, errorPositions, correctedPositions, targetPositions)}
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
