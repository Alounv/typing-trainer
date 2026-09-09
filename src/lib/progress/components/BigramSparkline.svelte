<!--
	Tiny inline chart of a single bigram's recent trend (mean transition time or error
	rate). Used standalone on the analytics page and embedded in trend columns of the
	bigram table. No axis labels — the point is shape, not values.

-->
<script lang="ts">
	import type { BigramTrendPoint } from '../metrics';

	interface Props {
		points: BigramTrendPoint[];
		/** Which metric to plot. */
		metric: 'meanTime' | 'errorRate';
	}

	let { points, metric }: Props = $props();

	/** Sized for a table column. 1px inset keeps stroke ends and the last dot
	 *  from clipping at the edges. */
	const WIDTH = 80;
	const HEIGHT = 24;
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
		// meanTime: lower (faster) → top of SVG, so improving reads as "up".
		// errorRate: lower (cleaner) → bottom of SVG, so improving reads as "down".
		const norm = (value - yMin) / yRange;
		const projected = metric === 'errorRate' ? 1 - norm : norm;
		return INSET + projected * innerH;
	}

	const projection = $derived.by(() => {
		if (points.length < 2) return null;
		const yMin = Math.min(...values);
		const yMax = Math.max(...values);
		return {
			yMin,
			yRange: yMax === yMin ? null : yMax - yMin,
			innerW: WIDTH - INSET * 2,
			innerH: HEIGHT - INSET * 2
		};
	});

	const path = $derived.by(() => {
		if (!projection) return '';
		const { yMin, yRange, innerW, innerH } = projection;
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
		if (!projection) return null;
		const { yMin, yRange, innerW, innerH } = projection;
		return { x: INSET + innerW, y: projectY(values.at(-1)!, yMin, yRange, innerH) };
	});

	// Direction hint — green if improving (last lower than first), muted otherwise.
	const improving = $derived(points.length >= 2 && values.at(-1)! < values[0]);
</script>

{#if points.length < 2}
	<span class="text-xs text-base-content/40">—</span>
{:else}
	<svg
		width={WIDTH}
		height={HEIGHT}
		role="img"
		aria-label={ariaLabel}
		class="inline-block align-middle"
	>
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
