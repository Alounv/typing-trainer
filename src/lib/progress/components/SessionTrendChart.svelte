<!--
	Generic per-session trend chart: raw dots, rolling-mean line, ±1σ band.
	Shared by the WPM and error-rate views because "raw + smoothed + envelope"
	is the house style for any per-session scalar (spec §10.6 + "never show
	raw X alone"). The component knows nothing about what the series means —
	that's the caller's job via `ariaLabel` + `formatY` + `color`.
-->
<script lang="ts">
	import type { TrendPoint } from '../metrics';

	interface Props {
		points: TrendPoint[];
		/** Chart height in CSS pixels. Width is 100% of the container. */
		height?: number;
		/** Screen-reader label for the overall chart. Required so each instance
		 * reads as a distinct figure to assistive tech. */
		ariaLabel: string;
		/** Format a y-axis tick value. Defaults to integer. */
		formatY?: (v: number) => string;
		/**
		 * Color variant. Maps to a DaisyUI semantic color so the chart can
		 * visually separate metrics ("primary" = WPM, "warning" = errors)
		 * without hardcoding hex. Keep in sync with `ClassificationBar` if
		 * you add more variants.
		 */
		variant?: 'primary' | 'warning';
		/** Override message shown when there's no data. */
		emptyLabel?: string;
	}

	let {
		points,
		height = 220,
		ariaLabel,
		formatY = (v) => v.toFixed(0),
		variant = 'primary',
		emptyLabel = 'No sessions yet — complete one to start the trend.'
	}: Props = $props();

	// Inner padding (SVG viewBox units). Leaves room for the y-axis labels on
	// the left and a single-line x-axis below.
	const PAD = { top: 12, right: 16, bottom: 28, left: 44 };

	let containerEl = $state<HTMLDivElement>();
	let width = $state(600);

	$effect(() => {
		if (!containerEl) return;
		const ro = new ResizeObserver((entries) => {
			width = Math.max(200, entries[0].contentRect.width);
		});
		ro.observe(containerEl);
		return () => ro.disconnect();
	});

	const innerW = $derived(width - PAD.left - PAD.right);
	const innerH = $derived(height - PAD.top - PAD.bottom);

	const domain = $derived.by(() => {
		if (points.length === 0) {
			return { xMin: 0, xMax: 1, yMin: 0, yMax: 1 };
		}
		const xs = points.map((p) => p.timestamp);
		const xMin = Math.min(...xs);
		const xMax = Math.max(...xs);
		const ys: number[] = [];
		for (const p of points) {
			ys.push(p.value);
			if (p.plus1Sigma !== null) ys.push(p.plus1Sigma);
			if (p.minus1Sigma !== null) ys.push(p.minus1Sigma);
		}
		let yMin = Math.min(...ys);
		let yMax = Math.max(...ys);
		if (yMin === yMax) {
			// Degenerate range — widen a little so the dot doesn't sit on the axis.
			const delta = Math.abs(yMin) * 0.1 || 1;
			yMin -= delta;
			yMax += delta;
		}
		const pad = (yMax - yMin) * 0.1;
		return {
			xMin: xMin === xMax ? xMin - 1 : xMin,
			xMax: xMin === xMax ? xMax + 1 : xMax,
			// Don't clamp yMin to 0 — error rate and other deltas may legitimately
			// want to show negative space. Callers that need a floor can clip via
			// domain shaping upstream.
			yMin: yMin - pad,
			yMax: yMax + pad
		};
	});

	function scaleX(t: number): number {
		const { xMin, xMax } = domain;
		return PAD.left + ((t - xMin) / (xMax - xMin)) * innerW;
	}
	function scaleY(v: number): number {
		const { yMin, yMax } = domain;
		return PAD.top + (1 - (v - yMin) / (yMax - yMin)) * innerH;
	}

	const rollingPath = $derived.by(() => {
		let d = '';
		let started = false;
		for (const p of points) {
			if (p.rolling === null) continue;
			const x = scaleX(p.timestamp);
			const y = scaleY(p.rolling);
			d += started ? ` L${x},${y}` : `M${x},${y}`;
			started = true;
		}
		return d;
	});

	const bandPath = $derived.by(() => {
		const ups: { x: number; y: number }[] = [];
		const downs: { x: number; y: number }[] = [];
		for (const p of points) {
			if (p.plus1Sigma === null || p.minus1Sigma === null) continue;
			const x = scaleX(p.timestamp);
			ups.push({ x, y: scaleY(p.plus1Sigma) });
			downs.push({ x, y: scaleY(p.minus1Sigma) });
		}
		if (ups.length === 0) return '';
		const top = ups.map((pt, i) => (i === 0 ? `M${pt.x},${pt.y}` : `L${pt.x},${pt.y}`)).join(' ');
		const bottom = [...downs]
			.reverse()
			.map((pt) => `L${pt.x},${pt.y}`)
			.join(' ');
		return `${top} ${bottom} Z`;
	});

	const yTicks = $derived.by(() => {
		const { yMin, yMax } = domain;
		const step = (yMax - yMin) / 4;
		return [0, 1, 2, 3, 4].map((i) => yMin + step * i);
	});

	const xLabels = $derived.by(() => {
		if (points.length === 0) return [];
		const fmt = (t: number) =>
			new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
		return [
			{ x: scaleX(points[0].timestamp), label: fmt(points[0].timestamp) },
			{
				x: scaleX(points.at(-1)!.timestamp),
				label: fmt(points.at(-1)!.timestamp)
			}
		];
	});

	// Map variant → Tailwind classes. Done as runtime derived values (not
	// class-string interpolation) so the Tailwind JIT sees the full class
	// literals and doesn't tree-shake them.
	const strokeClass = $derived(variant === 'warning' ? 'stroke-warning' : 'stroke-primary');
	const fillClass = $derived(variant === 'warning' ? 'fill-warning/10' : 'fill-primary/10');
</script>

<div bind:this={containerEl} class="w-full">
	{#if points.length === 0}
		<p class="text-sm text-base-content/60">{emptyLabel}</p>
	{:else}
		<svg {width} {height} role="img" aria-label={ariaLabel} class="overflow-visible">
			{#each yTicks as tick, i (i)}
				<line
					x1={PAD.left}
					x2={width - PAD.right}
					y1={scaleY(tick)}
					y2={scaleY(tick)}
					class="stroke-base-300"
					stroke-width="1"
				/>
				<text
					x={PAD.left - 6}
					y={scaleY(tick)}
					text-anchor="end"
					dominant-baseline="middle"
					class="fill-base-content/50 text-xs"
				>
					{formatY(tick)}
				</text>
			{/each}

			{#if bandPath}
				<path d={bandPath} class={fillClass} />
			{/if}

			{#if rollingPath}
				<path d={rollingPath} class={strokeClass} stroke-width="2" fill="none" />
			{/if}

			{#each points as p (p.sessionId)}
				<circle cx={scaleX(p.timestamp)} cy={scaleY(p.value)} r="3" class="fill-base-content/60" />
			{/each}

			{#each xLabels as label, i (i)}
				<text
					x={label.x}
					y={height - 8}
					text-anchor={i === 0 ? 'start' : 'end'}
					class="fill-base-content/50 text-xs"
				>
					{label.label}
				</text>
			{/each}
		</svg>
	{/if}
</div>
