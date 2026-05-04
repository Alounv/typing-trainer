<!--
	Thin WPM-specific wrapper around SessionTrendChart. Exists as a named
	component so the analytics page reads naturally and future tweaks (e.g.
	a pacing target line) can land here without leaking into the generic
	trend chart.
-->
<script lang="ts">
	import type { TrendPoint } from '../metrics';
	import SessionTrendChart from './SessionTrendChart.svelte';

	interface Props {
		points: TrendPoint[];
		height?: number;
	}

	let { points, height = 220 }: Props = $props();
</script>

<SessionTrendChart
	{points}
	{height}
	ariaLabel="Words-per-minute trend across sessions"
	variant="primary"
/>
