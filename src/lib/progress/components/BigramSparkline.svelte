<!--
	Tiny inline chart of a single bigram's recent mean transition time. Used
	standalone on the analytics page and embedded in each row of the bigram
	table's "trend" column. No axis labels — the point is shape, not values.
-->
<script lang="ts">
	import type { BigramTrendPoint } from '../metrics';

	interface Props {
		points: BigramTrendPoint[];
		/** Outer width in CSS pixels. Table column = ~80px, standalone = larger. */
		width?: number;
		height?: number;
	}

	let { points, width = 80, height = 24 }: Props = $props();

	// 1px inset so stroke endpoints + last dot don't clip at the edges.
	const INSET = 2;

	const path = $derived.by(() => {
		if (points.length < 2) return '';
		const ys = points.map((p) => p.meanTime);
		const yMin = Math.min(...ys);
		const yMax = Math.max(...ys);
		// Flat series would divide-by-zero. Render as a centred horizontal line.
		const yRange = yMax - yMin || 1;
		const innerW = width - INSET * 2;
		const innerH = height - INSET * 2;
		return points
			.map((p, i) => {
				const x = INSET + (i / (points.length - 1)) * innerW;
				// Faster (lower meanTime) = higher on screen → "improving" reads as "up".
				const y = INSET + ((p.meanTime - yMin) / yRange) * innerH;
				// Flip so small meanTime goes up, matching intuition.
				const flipped = height - y;
				return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${flipped.toFixed(1)}`;
			})
			.join(' ');
	});

	// Last dot highlights the current value. Skip drawing when we have <2 points
	// since there's no meaningful "trend" to anchor.
	const lastDot = $derived.by(() => {
		if (points.length < 2) return null;
		const ys = points.map((p) => p.meanTime);
		const yMin = Math.min(...ys);
		const yMax = Math.max(...ys);
		const yRange = yMax - yMin || 1;
		const innerW = width - INSET * 2;
		const innerH = height - INSET * 2;
		const last = points.at(-1)!;
		const x = INSET + innerW;
		const y = INSET + ((last.meanTime - yMin) / yRange) * innerH;
		return { x, y: height - y };
	});

	// Direction hint — green if improving (last faster than first), muted otherwise.
	const improving = $derived(points.length >= 2 && points.at(-1)!.meanTime < points[0].meanTime);
</script>

{#if points.length < 2}
	<span class="text-xs text-base-content/40">—</span>
{:else}
	<svg
		{width}
		{height}
		role="img"
		aria-label={`Recent trend across ${points.length} sessions`}
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
