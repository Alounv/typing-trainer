<!--
	Stacked horizontal bar showing the 4-way classification mix. Rendered twice:
	once for the primary row (today: live classification across all bigrams),
	once for the comparison row (today: the most recent diagnostic snapshot).
	The side-by-side layout makes shifts between acquisition/hasty/fluency/healthy
	visible at a glance — the single most important question the analytics
	page should answer.

	The component is intentionally agnostic about *what* each row represents:
	callers supply a label and counts. This keeps it reusable for future
	diagnostic-vs-diagnostic comparisons without reintroducing a hard dep on
	`DiagnosticReport`.
-->
<script lang="ts">
	import type { BigramClassification } from '../../support/core';

	/** One row of the bar. `label` and optional `meta` (shown right-aligned, e.g. a date) caption it. */
	export interface ClassificationBarRow {
		label: string;
		counts: {
			healthy: number;
			fluency: number;
			hasty: number;
			acquisition: number;
		};
		/** Optional right-aligned caption (e.g. a formatted date). Omit for live/"now" rows. */
		meta?: string;
	}

	interface Props {
		/** Primary row — rendered first, full opacity. */
		current: ClassificationBarRow;
		/**
		 * Comparison row, or `null` when there's nothing to compare against
		 * (e.g. no diagnostic has been run yet). When `null`, `previousPlaceholder`
		 * takes its place.
		 */
		previous: ClassificationBarRow | null;
		/** Copy shown in place of the `previous` row when it is `null`. */
		previousPlaceholder?: string;
	}

	let {
		current,
		previous,
		previousPlaceholder = 'No prior snapshot to compare against yet.'
	}: Props = $props();

	// Display order: worst → best. Mirrors the drill prescription severity
	// ladder so "moving right" always reads as "getting better".
	const ORDER: Exclude<BigramClassification, 'unclassified'>[] = [
		'acquisition',
		'hasty',
		'fluency',
		'healthy'
	];

	/** DaisyUI-compatible semantic colors — same palette as the bigram table's
	 * classification badges. Consistency across views is worth the coupling. */
	const COLOR: Record<(typeof ORDER)[number], string> = {
		acquisition: 'bg-error',
		hasty: 'bg-warning',
		fluency: 'bg-info',
		healthy: 'bg-success'
	};

	interface Segment {
		label: (typeof ORDER)[number];
		count: number;
		percent: number;
	}

	/** Build segment data for one row. Zero-count segments are retained so
	 * the legend always shows all four buckets (user learns the vocabulary). */
	function segments(row: ClassificationBarRow): Segment[] {
		const total = ORDER.reduce((sum, k) => sum + row.counts[k], 0);
		return ORDER.map((k) => ({
			label: k,
			count: row.counts[k],
			// Divide-by-zero guard: an all-zero input (nothing classified yet)
			// would render a flat bar, which is fine — the caller decides
			// whether to show it at all via an empty-state branch.
			percent: total === 0 ? 0 : (row.counts[k] / total) * 100
		}));
	}

	const currentSegments = $derived(segments(current));
	const previousSegments = $derived(previous ? segments(previous) : null);
</script>

<div class="space-y-4">
	<!-- Primary row. -->
	<div class="space-y-2" data-testid="classification-current">
		<div class="flex items-baseline justify-between text-sm">
			<span class="font-medium">{current.label}</span>
			{#if current.meta}
				<span class="text-base-content/50">{current.meta}</span>
			{/if}
		</div>
		<div
			class="flex h-6 w-full overflow-hidden rounded-md border border-base-300"
			role="img"
			aria-label="Classification distribution, {current.label}"
		>
			{#each currentSegments as seg (seg.label)}
				{#if seg.percent > 0}
					<div
						class="{COLOR[
							seg.label
						]} flex items-center justify-center text-xs font-medium text-white"
						style="width: {seg.percent}%"
						title={`${seg.label}: ${seg.count}`}
					>
						{#if seg.percent >= 8}
							{seg.count}
						{/if}
					</div>
				{/if}
			{/each}
		</div>
	</div>

	<!-- Comparison row, or placeholder when nothing to compare against. -->
	{#if previous && previousSegments}
		<div class="space-y-2" data-testid="classification-previous">
			<div class="flex items-baseline justify-between text-sm">
				<span class="font-medium text-base-content/70">{previous.label}</span>
				{#if previous.meta}
					<span class="text-base-content/50">{previous.meta}</span>
				{/if}
			</div>
			<div
				class="flex h-6 w-full overflow-hidden rounded-md border border-base-300 opacity-70"
				role="img"
				aria-label="Classification distribution, {previous.label}"
			>
				{#each previousSegments as seg (seg.label)}
					{#if seg.percent > 0}
						<div
							class="{COLOR[
								seg.label
							]} flex items-center justify-center text-xs font-medium text-white"
							style="width: {seg.percent}%"
							title={`${seg.label}: ${seg.count}`}
						>
							{#if seg.percent >= 8}
								{seg.count}
							{/if}
						</div>
					{/if}
				{/each}
			</div>
		</div>
	{:else}
		<p class="text-sm text-base-content/55">{previousPlaceholder}</p>
	{/if}

	<!-- Legend. Always present so the color mapping isn't guesswork. -->
	<ul class="flex flex-wrap gap-x-4 gap-y-2 text-xs text-base-content/70">
		{#each ORDER as label (label)}
			<li class="flex items-center gap-1.5">
				<span class="inline-block h-2.5 w-2.5 rounded-sm {COLOR[label]}"></span>
				<span>{label}</span>
			</li>
		{/each}
	</ul>

	<!--
		Collapsed definitions. The vocabulary (acquisition / hasty / fluency /
		healthy) is jargon the first time a user sees it — keep the glossary one
		click away rather than cluttering the primary view.
	-->
	<details class="text-xs text-base-content/70">
		<summary class="cursor-pointer text-base-content/60 select-none hover:text-base-content">
			What do these mean?
		</summary>
		<dl class="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
			<dt class="flex items-center gap-1.5 font-medium">
				<span class="inline-block h-2.5 w-2.5 rounded-sm {COLOR.acquisition}"></span>
				Acquisition
			</dt>
			<dd class="text-base-content/65">Slow and error-prone — still learning the pair.</dd>

			<dt class="flex items-center gap-1.5 font-medium">
				<span class="inline-block h-2.5 w-2.5 rounded-sm {COLOR.hasty}"></span>
				Hasty
			</dt>
			<dd class="text-base-content/65">Fast but error-prone — speed outpacing accuracy.</dd>

			<dt class="flex items-center gap-1.5 font-medium">
				<span class="inline-block h-2.5 w-2.5 rounded-sm {COLOR.fluency}"></span>
				Fluency
			</dt>
			<dd class="text-base-content/65">Accurate but slow — needs speed work.</dd>

			<dt class="flex items-center gap-1.5 font-medium">
				<span class="inline-block h-2.5 w-2.5 rounded-sm {COLOR.healthy}"></span>
				Healthy
			</dt>
			<dd class="text-base-content/65">Fast and accurate — the goal.</dd>
		</dl>
	</details>
</div>
