<script lang="ts">
	/**
	 * Live in-session error count. Purely presentational — the parent
	 * pushes the raw count in.
	 *
	 * WPM used to live here too, but a live speed readout during a drill
	 * encouraged racing at the expense of accuracy; it's now shown only on
	 * the post-session summary.
	 */
	interface Props {
		errorCount: number;
		class?: string;
	}

	let { errorCount, class: klass = '' }: Props = $props();
</script>

<div class="flex items-baseline gap-5 text-sm {klass}" role="status" aria-live="off">
	<span class="flex items-baseline gap-1.5">
		<span class="text-base-content/55">Errors</span>
		<span class="font-mono font-medium text-base-content tabular-nums">{errorCount}</span>
	</span>
</div>
