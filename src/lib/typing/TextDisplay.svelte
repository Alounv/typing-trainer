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
		pending: 'text-base-content/50',
		'typed-correct': 'text-base-content/70',
		// Uncorrected error: solid red tint — the mistake is still standing.
		'typed-error': 'text-error-content bg-error/25 rounded-sm',
		// Corrected error: reads like typed-correct, but a thin dotted amber
		// underline marks where the user stumbled. No background, no
		// strikethrough — the correction should feel like recovery, not
		// punishment. The data still records it for analytics (spec §2.2).
		'typed-error-corrected':
			'text-base-content/70 underline decoration-dotted decoration-warning underline-offset-4',
		current: 'text-base-content bg-primary/20 border-b-2 border-primary rounded-sm'
	};
</script>

<div
	class="font-mono text-2xl leading-loose break-normal whitespace-pre-wrap"
	aria-label="Drill text"
>
	{#each chars as { char, state, ghost }, i (i)}
		<span
			class="transition-colors duration-75 motion-reduce:transition-none {stateClasses[
				state
			]} {ghost ? 'rounded-sm border-b-2 border-secondary bg-secondary/30' : ''}"
			data-state={state}
			data-ghost={ghost || undefined}>{char}</span
		>
	{/each}
</div>
