<script lang="ts">
	import type { ClassificationThresholds, SessionSummary } from '$lib/support/core';
	import { DEFAULT_HIGH_ERROR_THRESHOLD } from '$lib/support/core';
	import type { FrequencyTable } from '$lib/corpus';
	import { assessPacing, summarizeBigrams } from '$lib/skill';
	import { detectWindowedMovements, detectMilestone } from '../celebrations';
	import { buildBigramTrend } from '../metrics';
	import BigramMovements from './BigramMovements.svelte';
	import PacingBanner from './PacingBanner.svelte';
	import MilestoneBanner from './MilestoneBanner.svelte';
	import BigramTable from './BigramTable.svelte';

	interface Props {
		session: SessionSummary;
		/** Newest-first session list (capped at storage limit). */
		statsSessions: readonly SessionSummary[];
		corpusFrequencies?: FrequencyTable | undefined;
		thresholds: ClassificationThresholds;
	}

	let { session, statsSessions, corpusFrequencies = undefined, thresholds }: Props = $props();

	const milestone = $derived(detectMilestone(session, statsSessions));

	// Needs only the scalar wpm/errorRate, so this costs nothing beyond what the
	// page already loaded. `statsSessions` includes this session; it excludes
	// itself by id.
	const pacing = $derived(assessPacing(session, statsSessions));

	// Compare windowed classifications before vs. after this session so movements
	// reflect the user's overall standing — same view as the bigram table — rather
	// than a single noisy session's per-session classification.
	const allMovements = $derived(detectWindowedMovements(statsSessions, session.id, thresholds));

	// Every movement shows. The drill-era filtering by trained axis is gone with
	// the drills — a real-text session trains both, so hiding either half would
	// hide half of what changed.
	const movements = $derived(allMovements);

	const sessionRows = $derived.by(() => {
		const include = new Set<string>([
			...movements.map((m) => m.bigram),
			...(session.bigramsTargeted ?? [])
		]);
		if (include.size === 0) return [];
		const summaries = summarizeBigrams(statsSessions, corpusFrequencies, thresholds);
		return summaries
			.filter((row) => include.has(row.bigram))
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

<PacingBanner assessment={pacing} />

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

<BigramMovements
	events={movements}
	axisLabel={session.drillMode === 'accuracy' || session.drillMode === 'speed'
		? session.drillMode
		: undefined}
/>

{#if sessionRows.length > 0}
	<section class="space-y-3" data-testid="moved-bigrams-table">
		<div class="flex items-baseline justify-between">
			<h2 class="text-xl font-semibold">This session's bigrams</h2>
			<p class="text-sm text-base-content/55">
				{sessionRows.length}
				{sessionRows.length === 1 ? 'bigram' : 'bigrams'}
			</p>
		</div>
		<BigramTable rows={sessionRows} focus={session.drillMode} />
		<p class="text-xs text-base-content/55">
			Stats span the last 10 occurrences across all sessions — same as the Analytics page.
		</p>
	</section>
{/if}
