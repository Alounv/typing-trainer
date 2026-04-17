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

	// Pct formatter. One decimal is enough — error rate usually sits in the
	// single-digit percents, and more precision would crowd the axis.
	const formatY = (v: number) => `${(v * 100).toFixed(1)}%`;
</script>

<SessionTrendChart
	{points}
	{height}
	{formatY}
	ariaLabel="Error-rate trend across sessions"
	variant="warning"
/>
