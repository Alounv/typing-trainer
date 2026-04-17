<script lang="ts">
	/**
	 * Visual pace indicator. Advances a ghost position at `targetWPM` (5 chars = 1 word)
	 * and reports on-pace / behind / far-behind. Standalone, not overlaid.
	 */
	type PaceState = 'idle' | 'on-pace' | 'behind' | 'far-behind';

	interface Props {
		targetWPM: number;
		position: number;
		textLength: number;
		running: boolean;
		/**
		 * Two-way prop: the integer char index the pacer ghost currently sits
		 * on. Parent binds this and passes it to `TextDisplay` so the ghost is
		 * rendered inline with the text.
		 */
		ghostPosition?: number;
	}

	// `$bindable(0)` needs an initial value; ESLint's flow analysis doesn't
	// understand that the assignment is consumed by the rune, not the variable.
	// eslint-disable-next-line no-useless-assignment
	let { targetWPM, position, textLength, running, ghostPosition = $bindable(0) }: Props = $props();

	let elapsedMs = $state(0);

	// Standard convention: 1 word = 5 characters. Gives us the ms budget per
	// character at the target rate.
	const msPerChar = $derived(60_000 / (targetWPM * 5));

	// Ghost advances in elapsed time, capped at the text length so lag doesn't
	// keep growing after the user reaches the end.
	const expectedPosition = $derived(Math.min(textLength, elapsedMs / msPerChar));
	const lag = $derived(Math.max(0, Math.floor(expectedPosition - position)));

	// Keep the bindable ghost in sync with the clock. Floored so the ghost
	// lands on a discrete character — the UI can't underline half a glyph.
	$effect(() => {
		ghostPosition = Math.floor(expectedPosition);
	});

	const paceState = $derived.by((): PaceState => {
		if (!running && elapsedMs === 0) return 'idle';
		if (lag === 0) return 'on-pace';
		if (lag <= 3) return 'behind';
		return 'far-behind';
	});

	const labels: Record<PaceState, string> = {
		idle: 'Ready',
		'on-pace': 'On pace',
		behind: 'Behind',
		'far-behind': 'Far behind'
	};

	// Map pace state to DaisyUI semantic colors so theming carries through.
	const badgeClasses: Record<PaceState, string> = {
		idle: 'badge-ghost',
		'on-pace': 'badge-success',
		behind: 'badge-warning',
		'far-behind': 'badge-error'
	};

	// Drive `elapsedMs` while running. Ticks at 100ms — smooth transitions
	// without thrashing renders. `performance.now()` for precision.
	$effect(() => {
		if (!running) return;
		const anchor = performance.now() - elapsedMs;
		const id = window.setInterval(() => {
			elapsedMs = performance.now() - anchor;
		}, 100);
		return () => window.clearInterval(id);
	});
</script>

<div
	class="inline-flex items-center gap-2 text-sm"
	role="status"
	aria-live="polite"
	aria-label="Pace indicator"
>
	<span class="badge {badgeClasses[paceState]}">{labels[paceState]}</span>
	{#if paceState === 'behind' || paceState === 'far-behind'}
		<span class="text-base-content/60">
			{lag} char{lag === 1 ? '' : 's'} behind
		</span>
	{/if}
</div>
