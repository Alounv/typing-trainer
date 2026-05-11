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
		variant?: 'primary' | 'warning' | 'success';
		/** Override message shown when there's no data. */
		emptyLabel?: string;
		/** Hard floor for the y-axis (e.g. 0 for error rate). When the data range
		 * sits entirely above this floor, the axis still extends down to it so
		 * the chart is anchored to a meaningful zero. */
		yFloor?: number;
		/** Optional second series drawn underneath/around the primary as a muted
		 * envelope (e.g. "beyond acquisition" sitting above "healthy"). Shares
		 * the y-domain so both lines stay comparable. */
		secondary?: TrendPoint[];
	}

	let {
		points,
		height = 220,
		ariaLabel,
		formatY = (v) => v.toFixed(0),
		variant = 'primary',
		emptyLabel = 'No sessions yet — complete one to start the trend.',
		yFloor,
		secondary
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

	// Nice 1-2-5 step picker — snaps tick spacing and axis bounds to readable
	// values (e.g. WPM ticks at 80/85/90 rather than 82.4/85.1/87.8).
	function niceStep(range: number, targetCount: number): number {
		if (range <= 0 || !Number.isFinite(range)) return 1;
		const rough = range / Math.max(1, targetCount);
		const pow10 = Math.pow(10, Math.floor(Math.log10(rough)));
		const norm = rough / pow10;
		const nice = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
		return nice * pow10;
	}

	function buildNiceTicks(min: number, max: number, targetCount = 4) {
		const step = niceStep(max - min, targetCount);
		const niceMin = Math.floor(min / step) * step;
		const niceMax = Math.ceil(max / step) * step;
		const ticks: number[] = [];
		// Guard against FP drift accumulating past niceMax.
		const eps = step / 1e6;
		for (let v = niceMin; v <= niceMax + eps; v += step) {
			ticks.push(Math.round(v / step) * step);
		}
		return { ticks, niceMin, niceMax };
	}

	const domain = $derived.by(() => {
		if (points.length === 0) {
			return { xMin: 0, xMax: 1, yMin: 0, yMax: 1, ticks: [0, 0.25, 0.5, 0.75, 1] };
		}
		const xs = points.map((p) => p.timestamp);
		const xMin = Math.min(...xs);
		const xMax = Math.max(...xs);
		const ys: number[] = [];
		for (const p of points) {
			ys.push(p.value);
			if (p.plus1Sigma !== null) ys.push(p.plus1Sigma);
			if (p.minus1Sigma !== null) ys.push(p.minus1Sigma);
			if (p.low !== null) ys.push(p.low);
			if (p.high !== null) ys.push(p.high);
		}
		if (secondary) for (const p of secondary) ys.push(p.value);
		let yMin = Math.min(...ys);
		let yMax = Math.max(...ys);
		if (yMin === yMax) {
			// Degenerate range — widen a little so the dot doesn't sit on the axis.
			const delta = Math.abs(yMin) * 0.1 || 1;
			yMin -= delta;
			yMax += delta;
		}
		if (yFloor !== undefined) yMin = Math.min(yMin, yFloor);
		const { ticks, niceMin, niceMax } = buildNiceTicks(yMin, yMax, 4);
		return {
			xMin: xMin === xMax ? xMin - 1 : xMin,
			xMax: xMin === xMax ? xMax + 1 : xMax,
			yMin: niceMin,
			yMax: niceMax,
			ticks
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

	function buildPath(pts: readonly TrendPoint[] | undefined): string {
		if (!pts) return '';
		let d = '';
		let started = false;
		for (const p of pts) {
			if (p.rolling === null) continue;
			const x = scaleX(p.timestamp);
			const y = scaleY(p.rolling);
			d += started ? ` L${x},${y}` : `M${x},${y}`;
			started = true;
		}
		return d;
	}

	const rollingPath = $derived(buildPath(points));
	const secondaryPath = $derived(buildPath(secondary));

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

	const yTicks = $derived(domain.ticks);

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
	const strokeClass = $derived(
		variant === 'warning'
			? 'stroke-warning'
			: variant === 'success'
				? 'stroke-success'
				: 'stroke-primary'
	);
	const fillClass = $derived(
		variant === 'warning'
			? 'fill-warning/10'
			: variant === 'success'
				? 'fill-success/10'
				: 'fill-primary/10'
	);
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

			{#if secondaryPath}
				<path
					d={secondaryPath}
					class="stroke-base-content/35"
					stroke-width="1.5"
					stroke-dasharray="3 3"
					fill="none"
				/>
				{#each secondary ?? [] as p (`s-${p.sessionId}`)}
					<circle
						cx={scaleX(p.timestamp)}
						cy={scaleY(p.value)}
						r="2"
						class="fill-base-content/35"
					/>
				{/each}
			{/if}

			{#if rollingPath}
				<path d={rollingPath} class={strokeClass} stroke-width="2" fill="none" />
			{/if}

			{#each points as p (p.sessionId)}
				{#if p.low !== null && p.high !== null}
					<line
						x1={scaleX(p.timestamp)}
						x2={scaleX(p.timestamp)}
						y1={scaleY(p.high)}
						y2={scaleY(p.low)}
						class="stroke-base-content/20"
						stroke-width="1"
						stroke-linecap="round"
					/>
				{/if}
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
