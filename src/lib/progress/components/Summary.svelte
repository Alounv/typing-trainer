<script lang="ts">
	import type { SessionSummary } from '$lib/support/core';
	import { DEFAULT_HIGH_ERROR_THRESHOLD } from '$lib/support/core';
	import type { FrequencyTable } from '$lib/corpus';
	import { summarizeBigrams } from '$lib/skill';
	import { detectWindowedMovements, detectMilestone } from '../celebrations';
	import { buildBigramTrend } from '../metrics';
	import BigramMovements from './BigramMovements.svelte';
	import MilestoneBanner from './MilestoneBanner.svelte';
	import BigramTable from './BigramTable.svelte';

	interface Props {
		session: SessionSummary;
		/** Newest-first session list (capped at storage limit). */
		statsSessions: readonly SessionSummary[];
		corpusFrequencies?: FrequencyTable | undefined;
	}

	let { session, statsSessions, corpusFrequencies = undefined }: Props = $props();

	const milestone = $derived(detectMilestone(session, statsSessions));

	// Compare windowed classifications before vs. after this session so movements
	// reflect the user's overall standing — same view as the bigram table — rather
	// than a single noisy session's per-session classification.
	const movements = $derived(detectWindowedMovements(statsSessions, session.id));

	const movedRows = $derived.by(() => {
		if (movements.length === 0) return [];
		const moved = new Set(movements.map((m) => m.bigram));
		const summaries = summarizeBigrams(statsSessions, corpusFrequencies);
		return summaries
			.filter((row) => moved.has(row.bigram))
			.map((row) => ({ ...row, trend: buildBigramTrend(statsSessions, row.bigram) }));
	});

	const ERROR_WARN_THRESHOLD = DEFAULT_HIGH_ERROR_THRESHOLD / 2;
	function errorRateColour(rate: number): string {
		if (rate > DEFAULT_HIGH_ERROR_THRESHOLD) return 'text-error';
		if (rate > ERROR_WARN_THRESHOLD) return 'text-warning';
		return 'text-success';
	}
</script>

<MilestoneBanner event={milestone} />

<section class="space-y-4">
	<dl class="grid gap-6" style="grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));">
		<div class="space-y-2">
			<dt class="text-xs font-medium tracking-[0.18em] text-base-content/50 uppercase">Raw WPM</dt>
			<dd
				class="font-mono text-7xl leading-none font-medium text-base-content tabular-nums"
				data-testid="wpm-value"
			>
				{session.wpm.toFixed(1)}
			</dd>
			<dd class="text-sm text-base-content/60">Not smoothed — first-pass reading</dd>
		</div>
		<div class="space-y-2">
			<dt class="text-xs font-medium tracking-[0.18em] text-base-content/50 uppercase">Errors</dt>
			<dd
				class={`font-mono text-7xl leading-none font-medium tabular-nums ${errorRateColour(session.errorRate)}`}
				data-testid="error-rate-value"
			>
				{(session.errorRate * 100).toFixed(1)}%
			</dd>
			<dd class="text-sm text-base-content/60">First-input only — backspace doesn't erase</dd>
		</div>
	</dl>
</section>

<BigramMovements events={movements} />

{#if movedRows.length > 0}
	<section class="space-y-3" data-testid="moved-bigrams-table">
		<div class="flex items-baseline justify-between">
			<h2 class="text-xl font-semibold">Moved bigrams</h2>
			<p class="text-sm text-base-content/55">
				{movedRows.length}
				{movedRows.length === 1 ? 'bigram' : 'bigrams'} moved
			</p>
		</div>
		<BigramTable rows={movedRows} focus={session.drillMode} />
		<p class="text-xs text-base-content/55">
			Stats span the last 10 occurrences across all sessions — same as the Analytics page.
		</p>
	</section>
{/if}
