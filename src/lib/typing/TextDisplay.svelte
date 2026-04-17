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
		/** Positions whose first-input was wrong (spec §2.2 — first-input sticks). */
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

	const chars = $derived(
		text.split('').map((char, i) => ({
			char,
			state: stateFor(i, position, errorPositions, correctedPositions),
			// The ghost is only meaningful when it's ahead of the user.
			// If the pacer catches up or falls behind, no separate marker.
			ghost: ghostPosition !== undefined && i === ghostPosition && i > position
		}))
	);

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
		// Corrected error: reads like typed-correct, but a thin dotted amber
		// underline marks where the user stumbled. No background, no
		// strikethrough — the correction should feel like recovery, not
		// punishment. The data still records it for analytics (spec §2.2).
		'typed-error-corrected':
			'text-base-content/75 underline decoration-dotted decoration-warning underline-offset-4',
		// Current char: solid saturated block + thicker primary rule. Must
		// out-weight the pacer ghost (below) — cursor is the user's anchor,
		// pacer is peripheral.
		current: 'text-primary-content bg-primary/70 rounded-sm'
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

	$effect(() => {
		// Re-run when position changes. Relies on the viewport being
		// `position: relative` so the span's `offsetTop` is measured from
		// the viewport itself (not whatever ancestor happens to be
		// positioned).
		if (!viewportEl) return;
		const currentSpan = viewportEl.querySelector<HTMLElement>(`[data-pos="${position}"]`);
		if (!currentSpan) return;
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
	{#each chars as { char, state, ghost }, i (i)}
		<span
			class="transition-colors duration-75 motion-reduce:transition-none {stateClasses[
				state
			]} {ghost ? 'rounded-sm border-b border-secondary/60 bg-secondary/15' : ''}"
			data-state={state}
			data-pos={i}
			data-ghost={ghost || undefined}>{char}</span
		>
	{/each}
</div>
