<script lang="ts">
	/**
	 * Live in-session error count. Purely presentational — the parent
	 * pushes the raw count in.
	 *
	 * On accuracy drills the count renders in error-red to echo the
	 * error-budget bar above the drill: one consistent "accuracy-cost"
	 * signal instead of two unrelated readouts.
	 *
	 * WPM used to live here too, but a live speed readout during a drill
	 * encouraged racing at the expense of accuracy; it's now shown only on
	 * the post-session summary.
	 */
	import type { DrillMode } from '$lib/support/core';

	interface Props {
		errorCount: number;
		drillMode?: DrillMode;
		class?: string;
	}

	let { errorCount, drillMode, class: klass = '' }: Props = $props();
</script>

<div class="flex items-baseline gap-5 text-sm {klass}" role="status" aria-live="off">
	<span class="flex items-baseline gap-1.5">
		<span class="text-base-content/55">Errors</span>
		<span
			class="font-mono font-medium tabular-nums {drillMode === 'accuracy'
				? 'text-error'
				: 'text-base-content'}">{errorCount}</span
		>
	</span>
</div>
