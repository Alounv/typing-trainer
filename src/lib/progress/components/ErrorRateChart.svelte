<!--
	Per-session error-rate trend. Same shape as the WPM chart (raw dots, rolling
	line, σ-band) but tinted warning so WPM and errors never get visually
	confused. Formatted as percent so the axis reads like the rest of the app.
-->
<script lang="ts">
	import type { TrendPoint } from '../metrics';
	import SessionTrendChart from './SessionTrendChart.svelte';

	interface Props {
		points: TrendPoint[];
		height?: number;
	}

	let { points, height = 220 }: Props = $props();

	// Nice-tick axis lands on whole-percent steps in the common case, so drop
	// the decimal when it would be `.0`. Sub-percent ranges (e.g. an expert at
	// <1%) still get one decimal so the ticks stay distinct.
	const formatY = (v: number) => {
		const pct = Math.round(v * 1000) / 10;
		return Number.isInteger(pct) ? `${pct}%` : `${pct.toFixed(1)}%`;
	};
</script>

<SessionTrendChart
	{points}
	{height}
	{formatY}
	ariaLabel="Error-rate trend across sessions"
	variant="warning"
	yFloor={0}
/>
