<script lang="ts">
	/**
	 * Small mm:ss readout for session timing. Pure display — the parent
	 * owns the clock and pushes `elapsedMs` in (matches the runner's own
	 * "no internal clock" contract).
	 *
	 * When `totalMs` is supplied, shows a count-down (time remaining,
	 * clamped ≥ 0). Otherwise shows count-up of elapsed time. The display
	 * is in `font-mono + tabular-nums` so ticking digits don't jitter the
	 * surrounding layout.
	 */
	interface Props {
		elapsedMs: number;
		totalMs?: number;
		/** Extra classes — lets the parent style size / alignment. */
		class?: string;
	}

	let { elapsedMs, totalMs, class: klass = '' }: Props = $props();

	const displayMs = $derived(totalMs !== undefined ? Math.max(0, totalMs - elapsedMs) : elapsedMs);
	const minutes = $derived(Math.floor(displayMs / 60_000));
	const seconds = $derived(
		Math.floor((displayMs % 60_000) / 1000)
			.toString()
			.padStart(2, '0')
	);
</script>

<span
	class="font-mono text-base-content/80 tabular-nums {klass}"
	aria-label={totalMs !== undefined ? 'Time remaining' : 'Elapsed time'}
>
	{minutes}:{seconds}
</span>
