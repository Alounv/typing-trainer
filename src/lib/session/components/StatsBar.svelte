<script lang="ts">
	/**
	 * Live in-session stats: WPM + error count. Like Timer, purely
	 * presentational — the parent pushes the raw inputs in.
	 *
	 * WPM is computed from the `position` (how far the cursor has
	 * advanced) rather than `events.length`. Position excludes retypes;
	 * events.length would over-count them and inflate WPM for users who
	 * correct a lot. Spec-correct metric is per-position progress.
	 */
	interface Props {
		position: number;
		elapsedMs: number;
		errorCount: number;
		class?: string;
	}

	let { position, elapsedMs, errorCount, class: klass = '' }: Props = $props();

	const wpm = $derived.by(() => {
		// Sub-second readings are meaningless (noisy, divisor shrinks) —
		// hold at 0 until the user has been typing for a beat.
		if (elapsedMs < 500 || position === 0) return 0;
		return position / 5 / (elapsedMs / 60_000);
	});
</script>

<div class="flex items-baseline gap-5 text-sm {klass}" role="status" aria-live="off">
	<span class="flex items-baseline gap-1.5">
		<span class="text-base-content/55">WPM</span>
		<span class="font-mono font-medium text-base-content tabular-nums">{wpm.toFixed(0)}</span>
	</span>
	<span class="flex items-baseline gap-1.5">
		<span class="text-base-content/55">Errors</span>
		<span class="font-mono font-medium text-base-content tabular-nums">{errorCount}</span>
	</span>
</div>
