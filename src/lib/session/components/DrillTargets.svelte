<script lang="ts">
	import DrillTargetChip from './DrillTargetChip.svelte';
	import type { DrillMode } from '$lib/support/core';
	import type { LedgerEntry } from '../bigramLedger';

	interface Props {
		targetBigrams: readonly string[];
		exposureBigrams?: readonly string[];
		drillMode?: DrillMode;
		/** Accuracy drills only — drives the damaged / cleared chip states. */
		entries?: ReadonlyMap<string, LedgerEntry>;
	}

	let { targetBigrams, exposureBigrams, drillMode, entries }: Props = $props();

	const exposureSet = $derived(new Set(exposureBigrams ?? []));
	const hasMix = $derived(
		!!exposureBigrams &&
			exposureBigrams.length > 0 &&
			targetBigrams.some((b) => !exposureSet.has(b))
	);
	const showTint = $derived(drillMode === 'accuracy' || drillMode === 'speed');
</script>

<div
	class="grid max-w-xl grid-cols-[5rem_1fr] items-baseline gap-x-4 gap-y-2 border-t border-base-300 pt-4"
>
	<span class="text-[11px] font-medium tracking-[0.18em] text-base-content/40 uppercase">
		Drilling
	</span>
	<ul class="flex flex-wrap gap-1.5" aria-label="Drill targets">
		{#each targetBigrams as bigram (bigram)}
			<DrillTargetChip {bigram} isExposure={exposureSet.has(bigram)} entry={entries?.get(bigram)} />
		{/each}
	</ul>
	{#if hasMix || showTint || entries}
		<span></span>
		<p class="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[11px] text-base-content/50">
			{#if hasMix}
				<span class="inline-flex items-baseline gap-1.5">
					<span
						class="inline-block rounded-sm bg-base-200 px-1.5 py-0.5 align-middle font-mono text-base-content/80"
						>ab</span
					>
					diagnosed
				</span>
				<span class="inline-flex items-baseline gap-1.5">
					<span
						class="inline-block rounded-sm border border-dashed border-base-content/40 px-1.5 py-0.5 align-middle font-mono text-base-content/60"
						>cd</span
					>
					exposure
				</span>
			{/if}
			{#if entries}
				<span class="inline-flex items-baseline gap-1.5">
					<span
						class="inline-block rounded-sm bg-error/15 px-1.5 py-0.5 align-middle font-mono text-error ring-1 ring-error/40"
						>ab</span
					>
					owes clean repeats
				</span>
				<span class="inline-flex items-baseline gap-1.5">
					<span
						class="inline-block rounded-sm bg-success/15 px-1.5 py-0.5 align-middle font-mono text-success ring-1 ring-success/40"
						>cd</span
					>
					paid back
				</span>
			{/if}
			{#if showTint}
				<span class="inline-flex items-baseline gap-1.5">
					<span
						class="inline-block px-0.5 align-middle font-mono"
						style={`color: var(${drillMode === 'speed' ? '--color-info' : '--color-warning'})`}
						>ab</span
					>
					{drillMode === 'speed' ? 'slowest — chase it' : 'error-prone — slow down'}
				</span>
			{/if}
		</p>
	{/if}
</div>
