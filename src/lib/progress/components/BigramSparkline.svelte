<!--
	Tiny inline chart of a single bigram's recent trend (mean transition time or error
	rate). Used standalone on the analytics page and embedded in trend columns of the
	bigram table. No axis labels — the point is shape, not values.

	Convention: lower value = better. Improving reads as "up" (line climbs), green when
	the latest value is below the oldest in the window.
-->
<script lang="ts">
	import type { BigramTrendPoint } from '../metrics';

	interface Props {
		points: BigramTrendPoint[];
		/** Which metric to plot. Both follow lower=better semantics. */
		metric?: 'meanTime' | 'errorRate';
		/** Outer width in CSS pixels. Table column = ~80px, standalone = larger. */
		width?: number;
		height?: number;
	}

	let { points, metric = 'meanTime', width = 80, height = 24 }: Props = $props();

	// 1px inset so stroke endpoints + last dot don't clip at the edges.
	const INSET = 2;

	const ariaLabel = $derived(
		metric === 'errorRate'
			? `Recent error-rate trend across ${points.length} sessions`
			: `Recent speed trend across ${points.length} sessions`
	);

	const values = $derived(points.map((p) => p[metric]));

	// `null` yRange means flat series — render the line vertically centred so "no
	// change" doesn't read as "stuck at the worst value".
	function projectY(value: number, yMin: number, yRange: number | null, innerH: number): number {
		if (yRange === null) return INSET + innerH / 2;
		// SVG y grows downward: yMin (best) → small y → top of SVG. Improving reads as "up".
		return INSET + ((value - yMin) / yRange) * innerH;
	}

	const path = $derived.by(() => {
		if (points.length < 2) return '';
		const yMin = Math.min(...values);
		const yMax = Math.max(...values);
		const yRange = yMax === yMin ? null : yMax - yMin;
		const innerW = width - INSET * 2;
		const innerH = height - INSET * 2;
		return points
			.map((_, i) => {
				const x = INSET + (i / (points.length - 1)) * innerW;
				const y = projectY(values[i], yMin, yRange, innerH);
				return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
			})
			.join(' ');
	});

	// Last dot highlights the current value. Skip drawing when we have <2 points
	// since there's no meaningful "trend" to anchor.
	const lastDot = $derived.by(() => {
		if (points.length < 2) return null;
		const yMin = Math.min(...values);
		const yMax = Math.max(...values);
		const yRange = yMax === yMin ? null : yMax - yMin;
		const innerW = width - INSET * 2;
		const innerH = height - INSET * 2;
		return { x: INSET + innerW, y: projectY(values.at(-1)!, yMin, yRange, innerH) };
	});

	// Direction hint — green if improving (last lower than first), muted otherwise.
	const improving = $derived(points.length >= 2 && values.at(-1)! < values[0]);
</script>

{#if points.length < 2}
	<span class="text-xs text-base-content/40">—</span>
{:else}
	<svg {width} {height} role="img" aria-label={ariaLabel} class="inline-block align-middle">
		<path
			d={path}
			fill="none"
			stroke-width="1.5"
			class={improving ? 'stroke-success' : 'stroke-base-content/50'}
		/>
		{#if lastDot}
			<circle
				cx={lastDot.x}
				cy={lastDot.y}
				r="2"
				class={improving ? 'fill-success' : 'fill-base-content/70'}
			/>
		{/if}
	</svg>
{/if}
