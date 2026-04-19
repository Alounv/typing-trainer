<!--
	Stacked horizontal bar showing the 4-way classification mix. Rendered twice:
	once for the current diagnostic, once for the previous (spec §10.6). The
	side-by-side layout makes shifts between acquisition/hasty/fluency/healthy
	visible at a glance — the single most important question the analytics
	page should answer.
-->
<script lang="ts">
	import type { DiagnosticReport } from '../../diagnostic/types';
	import type { BigramClassification } from '../../bigram/types';

	interface Props {
		/** Most recent diagnostic. Required — the whole point of the component. */
		current: DiagnosticReport;
		/**
		 * Prior diagnostic, if one exists. `null` on the first diagnostic, in
		 * which case the "previous" row is replaced with a gentle explainer.
		 */
		previous: DiagnosticReport | null;
	}

	let { current, previous }: Props = $props();

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

	/** Build segment data for one report. Zero-count segments are retained so
	 * the legend always shows all four buckets (user learns the vocabulary). */
	function segments(report: DiagnosticReport): Segment[] {
		const total = ORDER.reduce((sum, k) => sum + report.counts[k], 0);
		return ORDER.map((k) => ({
			label: k,
			count: report.counts[k],
			// Divide-by-zero guard: an empty diagnostic would be a bug upstream,
			// but don't NaN the percentage if it happens.
			percent: total === 0 ? 0 : (report.counts[k] / total) * 100
		}));
	}

	const currentSegments = $derived(segments(current));
	const previousSegments = $derived(previous ? segments(previous) : null);
</script>

<div class="space-y-4">
	<!-- Current diagnostic row. -->
	<div class="space-y-2" data-testid="classification-current">
		<div class="flex items-baseline justify-between text-sm">
			<span class="font-medium">Current diagnostic</span>
			<span class="text-base-content/50">
				{new Date(current.timestamp).toLocaleDateString(undefined, {
					month: 'short',
					day: 'numeric',
					year: 'numeric'
				})}
			</span>
		</div>
		<div
			class="flex h-6 w-full overflow-hidden rounded-md border border-base-300"
			role="img"
			aria-label="Classification distribution, current diagnostic"
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

	<!-- Previous diagnostic row, or first-diagnostic placeholder. -->
	{#if previous && previousSegments}
		<div class="space-y-2" data-testid="classification-previous">
			<div class="flex items-baseline justify-between text-sm">
				<span class="font-medium text-base-content/70">Previous diagnostic</span>
				<span class="text-base-content/50">
					{new Date(previous.timestamp).toLocaleDateString(undefined, {
						month: 'short',
						day: 'numeric',
						year: 'numeric'
					})}
				</span>
			</div>
			<div
				class="flex h-6 w-full overflow-hidden rounded-md border border-base-300 opacity-70"
				role="img"
				aria-label="Classification distribution, previous diagnostic"
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
		<p class="text-sm text-base-content/55">
			No prior diagnostic to compare against yet — the next diagnostic will show a delta here.
		</p>
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
