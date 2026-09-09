<script lang="ts">
	import type { ClassificationThresholds, SessionSummary } from '$lib/support/core';
	import type { FrequencyTable } from '$lib/corpus';
	import { summarizeBigrams } from '$lib/skill';
	import {
		buildDailyErrorRateSeries,
		buildBigramProgressSeries,
		buildDailyWpmSeries,
		buildBigramRows,
		tallyClassificationMix
	} from '../metrics';
	import SessionTrendChart from './SessionTrendChart.svelte';
	import BigramTable from './BigramTable.svelte';
	import ClassificationBar from './ClassificationBar.svelte';

	interface Props {
		sessions: readonly SessionSummary[];
		corpusFrequencies: FrequencyTable | undefined;
		thresholds: ClassificationThresholds;
	}

	let { sessions, corpusFrequencies, thresholds }: Props = $props();

	// Every session, not just diagnostics: with one session type there is no
	// longer a calibration run to single out, and the trend is more honest for
	// covering everything typed.
	const wpm = $derived(buildDailyWpmSeries(sessions));
	const errorRate = $derived(buildDailyErrorRateSeries(sessions));
	const bigramProgress = $derived(buildBigramProgressSeries(sessions, thresholds));
	const bigramRows = $derived(
		buildBigramRows(sessions, summarizeBigrams(sessions, corpusFrequencies, thresholds))
	);
	const liveClassification = $derived(tallyClassificationMix(bigramRows));

	// Nice-tick axis lands on whole-percent steps in the common case, so drop the
	// decimal when it would be `.0`. A sub-percent range still gets one decimal so
	// the ticks stay distinct.
	function formatPercent(v: number): string {
		const pct = Math.round(v * 1000) / 10;
		return Number.isInteger(pct) ? `${pct}%` : `${pct.toFixed(1)}%`;
	}

	const classifiedCount = $derived(
		liveClassification.counts.healthy +
			liveClassification.counts.fluency +
			liveClassification.counts.hasty +
			liveClassification.counts.acquisition
	);
</script>

<section class="space-y-3" data-testid="wpm-trend">
	<div class="flex items-baseline justify-between">
		<h2 class="text-xl font-semibold">WPM trend</h2>
		<p class="text-sm text-base-content/55">
			{sessions.length}
			{sessions.length === 1 ? 'session' : 'sessions'}
		</p>
	</div>
	<div class="rounded-lg border border-base-300 bg-base-100 p-4">
		<SessionTrendChart points={wpm} ariaLabel="Words-per-minute trend across sessions" />
	</div>
	<p class="text-xs text-base-content/55">
		Dots are the daily median across sessions. On days with several sessions, a vertical whisker
		shows the day's full range. The line is a 7-day rolling average; the shaded band is ±1σ around
		that average.
	</p>
</section>

<section class="space-y-3" data-testid="error-rate-trend">
	<div class="flex items-baseline justify-between">
		<h2 class="text-xl font-semibold">Error rate</h2>
		<p class="text-sm text-base-content/55">Per day (median)</p>
	</div>
	<div class="rounded-lg border border-base-300 bg-base-100 p-4">
		<SessionTrendChart
			points={errorRate}
			ariaLabel="Error-rate trend across sessions"
			variant="warning"
			yFloor={0}
			formatY={formatPercent}
		/>
	</div>
	<p class="text-xs text-base-content/55">
		Daily median of the per-session error rate (fraction of keystrokes that were first-input
		errors), with the day's full range shown as a vertical whisker on multi-session days. The line
		smooths across 7 days.
	</p>
</section>

<section class="space-y-3" data-testid="healthy-bigrams-trend">
	<div class="flex items-baseline justify-between">
		<h2 class="text-xl font-semibold">Bigram progress</h2>
		<p class="text-sm text-base-content/55">Across all sessions</p>
	</div>
	<div class="rounded-lg border border-base-300 bg-base-100 p-4">
		<SessionTrendChart
			points={bigramProgress.healthy}
			secondary={bigramProgress.beyondAcquisition}
			yFloor={0}
			ariaLabel="Bigram progress across sessions"
			variant="success"
			emptyLabel="No sessions yet — complete one to start tracking bigram progress."
		/>
		<div
			class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-base-content/60"
			aria-hidden="true"
		>
			<span class="inline-flex items-center gap-1.5">
				<span class="inline-block h-0.5 w-4 bg-success"></span>
				Healthy
			</span>
			<span class="inline-flex items-center gap-1.5">
				<span
					class="inline-block h-0.5 w-4 bg-base-content/35"
					style="background-image: linear-gradient(to right, currentColor 50%, transparent 50%); background-size: 6px 100%;"
				></span>
				Beyond acquisition (healthy + fluency + hasty)
			</span>
		</div>
	</div>
	<p class="text-xs text-base-content/55">
		Solid: bigrams classified healthy. Dashed: total past the acquisition phase (healthy + fluency +
		hasty). The gap is your in-progress practice.
	</p>
</section>

<section class="space-y-3" data-testid="classification-distribution">
	<div class="flex items-baseline justify-between">
		<h2 class="text-xl font-semibold">Classification mix</h2>
	</div>
	{#if classifiedCount > 0}
		<div class="rounded-lg border border-base-300 bg-base-100 p-4">
			<ClassificationBar
				current={{
					label: 'Current classification',
					counts: liveClassification.counts,
					meta: 'Now'
				}}
			/>
		</div>
		{#if liveClassification.unclassified > 0}
			<p class="text-xs text-base-content/55">
				{liveClassification.unclassified}
				{liveClassification.unclassified === 1 ? 'bigram is' : 'bigrams are'} still undertrained (fewer
				than 10 observations) and excluded from the bar.
			</p>
		{/if}
		<p class="text-xs text-base-content/55">
			Each segment is a bigram bucket sized by share of your classified bigrams. Goal over time:
			shift the bar toward green (healthy).
		</p>
	{:else}
		<p class="text-sm text-base-content/60">
			Not enough practice yet — classifications need at least 10 observations per bigram. Keep
			drilling and this will fill in.
		</p>
	{/if}
</section>

<section class="space-y-3" data-testid="bigram-table">
	<div class="flex items-baseline justify-between">
		<h2 class="text-xl font-semibold">Bigram breakdown</h2>
		<p class="text-sm text-base-content/55">
			{bigramRows.length}
			{bigramRows.length === 1 ? 'bigram observed' : 'bigrams observed'}
		</p>
	</div>
	<BigramTable rows={bigramRows} />
	<p class="text-xs text-base-content/55">
		Default sort: priority (badness × corpus frequency). Tap any column to re-sort; tap again to
		flip direction.
	</p>
</section>
