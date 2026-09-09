<!--
	Stacked horizontal bar showing the 4-way classification mix across all
	bigrams. Makes shifts between acquisition/hasty/fluency/healthy visible at a
	glance — the single most important question the analytics page should answer.
-->
<script lang="ts">
	import {
		CLASSIFICATION_COLOR as COLOR,
		CLASSIFICATION_ORDER as ORDER,
		type DisplayedClassification
	} from '../classificationDisplay';

	interface Props {
		counts: Record<DisplayedClassification, number>;
	}

	let { counts }: Props = $props();

	const segments = $derived.by(() => {
		const total = ORDER.reduce((sum, k) => sum + counts[k], 0);
		return ORDER.map((k) => ({
			label: k,
			count: counts[k],
			// An all-zero input renders a flat bar, which is fine — the caller
			// decides whether to show it at all via its empty-state branch.
			percent: total === 0 ? 0 : (counts[k] / total) * 100
		}));
	});
</script>

<div class="space-y-4">
	<div class="space-y-2" data-testid="classification-current">
		<div
			class="flex h-6 w-full overflow-hidden rounded-md border border-base-300"
			role="img"
			aria-label="Current classification distribution"
		>
			{#each segments as seg (seg.label)}
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

	<dl class="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs text-base-content/70">
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
</div>
