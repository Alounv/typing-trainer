<script lang="ts">
	import type { ClassificationThresholds, SessionSummary } from '$lib/support/core';
	import type { FrequencyTable } from '$lib/corpus';
	import { summarizeBigrams } from '$lib/skill';
	import {
		buildErrorRateSeries,
		buildHealthyBigramSeries,
		buildWpmSeries,
		buildBigramTrendFromSamples,
		buildRecentSamplesIndex,
		countGraduations,
		tallyClassificationMix
	} from '../metrics';
	import WpmChart from './WpmChart.svelte';
	import ErrorRateChart from './ErrorRateChart.svelte';
	import SessionTrendChart from './SessionTrendChart.svelte';
	import BigramTable from './BigramTable.svelte';
	import ClassificationBar from './ClassificationBar.svelte';

	interface Props {
		sessions: readonly SessionSummary[];
		diagnosticSessions: readonly SessionSummary[];
		corpusFrequencies: FrequencyTable | undefined;
		thresholds: ClassificationThresholds;
	}

	let { sessions, diagnosticSessions, corpusFrequencies, thresholds }: Props = $props();

	/** Two most recent diagnostic sessions with an attached report, newest first. */
	function pickDiagnosticSessions(list: readonly SessionSummary[]): SessionSummary[] {
		return list.filter((s) => s.diagnosticReport).slice(0, 2);
	}

	const wpm = $derived(buildWpmSeries(diagnosticSessions));
	const errorRate = $derived(buildErrorRateSeries(diagnosticSessions));
	const healthyOverTime = $derived(
		buildHealthyBigramSeries(sessions, corpusFrequencies, thresholds)
	);
	const bigrams = $derived(summarizeBigrams(sessions, corpusFrequencies, thresholds));
	// Sparkline window=10, depth=10 → 19 most-recent samples per bigram suffice.
	const trendSamplesIdx = $derived(buildRecentSamplesIndex(sessions, 19));
	const bigramRows = $derived(
		bigrams.map((row) => ({
			...row,
			trend: buildBigramTrendFromSamples(trendSamplesIdx.get(row.bigram) ?? [])
		}))
	);
	const liveClassification = $derived(tallyClassificationMix(bigrams));

	const latestAndPrevDiagnostic = $derived(pickDiagnosticSessions(diagnosticSessions));

	/** Graduations are a diagnostic-to-diagnostic measurement; `null` until two exist. */
	const graduatedCount = $derived.by(() => {
		const [latest, previous] = latestAndPrevDiagnostic;
		return latest && previous
			? countGraduations(previous.bigramAggregates, latest.bigramAggregates)
			: null;
	});

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
			{diagnosticSessions.length}
			{diagnosticSessions.length === 1 ? 'diagnostic' : 'diagnostics'}
		</p>
	</div>
	<div class="rounded-lg border border-base-300 bg-base-100 p-4">
		<WpmChart points={wpm} />
	</div>
	<p class="text-xs text-base-content/55">
		Dots are individual diagnostic sessions. The line is a 7-diagnostic rolling average; the shaded
		band is ±1σ around that average.
	</p>
</section>

<section class="space-y-3" data-testid="error-rate-trend">
	<div class="flex items-baseline justify-between">
		<h2 class="text-xl font-semibold">Error rate</h2>
		<p class="text-sm text-base-content/55">Per diagnostic</p>
	</div>
	<div class="rounded-lg border border-base-300 bg-base-100 p-4">
		<ErrorRateChart points={errorRate} />
	</div>
	<p class="text-xs text-base-content/55">
		Fraction of keystrokes that were first-input errors, per diagnostic. The line smooths across 7
		diagnostics.
	</p>
</section>

<section class="space-y-3" data-testid="healthy-bigrams-trend">
	<div class="flex items-baseline justify-between">
		<h2 class="text-xl font-semibold">Healthy bigrams</h2>
		<p class="text-sm text-base-content/55">Across all sessions</p>
	</div>
	<div class="rounded-lg border border-base-300 bg-base-100 p-4">
		<SessionTrendChart
			points={healthyOverTime}
			ariaLabel="Healthy bigram count across sessions"
			variant="success"
			emptyLabel="No sessions yet — complete one to start tracking healthy bigrams."
		/>
	</div>
	<p class="text-xs text-base-content/55">
		Cumulative count of bigrams classified healthy by the rolling-window classifier as of each
		session. Counts can dip when newer samples regress a previously healthy bigram.
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
		{#if graduatedCount !== null}
			<p class="text-sm text-base-content/70" data-testid="graduations-delta">
				{#if graduatedCount === 0}
					No bigrams graduated to healthy between diagnostics yet — keep going.
				{:else if graduatedCount === 1}
					<span class="font-medium text-success">1 bigram</span> graduated to healthy since the previous
					diagnostic.
				{:else}
					<span class="font-medium text-success">{graduatedCount} bigrams</span>
					graduated to healthy since the previous diagnostic.
				{/if}
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
			{bigrams.length}
			{bigrams.length === 1 ? 'bigram observed' : 'bigrams observed'}
		</p>
	</div>
	<BigramTable rows={bigramRows} />
	<p class="text-xs text-base-content/55">
		Default sort: priority (badness × corpus frequency). Tap any column to re-sort; tap again to
		flip direction.
	</p>
</section>
