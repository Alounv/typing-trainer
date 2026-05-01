<!--
	Compact horizontal diagram showing one bigram movement along the
	acquisition→hasty→fluency→healthy ladder. The arrow's span makes "moved
	one step" vs "moved three steps" instantly readable; its color signals
	improvement (success) vs regression (warning).
-->
<script lang="ts">
	import {
		CLASSIFICATION_FILL,
		CLASSIFICATION_ORDER,
		CLASSIFICATION_TEXT,
		type DisplayedClassification
	} from '../classificationDisplay';
	import {
		NEW_W,
		SWATCH_H,
		SWATCH_W,
		TOTAL_HEIGHT,
		TOTAL_WIDTH,
		TRACK_Y,
		arrowGeometry,
		stageCenters
	} from '../bigramMovementGeometry';

	interface Props {
		from: DisplayedClassification | null;
		to: DisplayedClassification;
		direction: 'up' | 'down';
	}

	let { from, to, direction }: Props = $props();

	const centers = stageCenters();
	const arrow = $derived(arrowGeometry(from, to));
	const arrowColorClass = $derived(CLASSIFICATION_TEXT[to]);
</script>

<svg
	viewBox={`0 0 ${TOTAL_WIDTH} ${TOTAL_HEIGHT}`}
	width={TOTAL_WIDTH}
	height={TOTAL_HEIGHT}
	role="img"
	aria-label={`${from ?? 'new'} to ${to}, ${direction === 'up' ? 'improved' : 'regressed'}`}
	data-testid="movement-track"
	data-from={from ?? 'new'}
	data-to={to}
	data-direction={direction}
>
	<!-- "new" marker: small dashed outline so it's visually distinct from the four real stages. -->
	<circle
		cx={centers[0].cx}
		cy={TRACK_Y + SWATCH_H / 2}
		r={NEW_W / 2 - 1}
		class="fill-none stroke-base-content/40"
		stroke-dasharray="2 2"
	/>

	<!-- Stage swatches -->
	{#each CLASSIFICATION_ORDER as cls, i (cls)}
		{@const cx = centers[i + 1].cx}
		<rect
			x={cx - SWATCH_W / 2}
			y={TRACK_Y}
			width={SWATCH_W}
			height={SWATCH_H}
			rx="2"
			class={CLASSIFICATION_FILL[cls]}
		/>
	{/each}

	<!-- Arrow arc -->
	<defs>
		<marker
			id={`arrowhead-${direction}-${from ?? 'new'}-${to}`}
			viewBox="0 0 6 6"
			refX="5"
			refY="3"
			markerWidth="5"
			markerHeight="5"
			orient="auto-start-reverse"
		>
			<path d="M0 0 L6 3 L0 6 z" fill="currentColor" />
		</marker>
	</defs>
	<path
		d={arrow.path}
		fill="none"
		stroke="currentColor"
		stroke-width="1.5"
		class={arrowColorClass}
		marker-end={`url(#arrowhead-${direction}-${from ?? 'new'}-${to})`}
	/>
</svg>
