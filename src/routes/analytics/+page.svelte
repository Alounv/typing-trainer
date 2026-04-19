<!--
	Analytics page. Long-term trends: WPM over time, per-bigram breakdown,
	classification distribution. Dashboard covers "now what?" — this is "how
	far have I come?". All reads are client-side out of IndexedDB; corpus is
	loaded lazily so priority scores line up with the user's chosen language.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { getProfile, getRecentSessions } from '$lib/storage/service';
	import {
		buildErrorRateSeries,
		buildWpmSeries,
		countGraduations,
		summarizeBigrams,
		type BigramSummary,
		type TrendPoint,
		type WpmPoint
	} from '$lib/progress/metrics';
	import WpmChart from '$lib/progress/components/WpmChart.svelte';
	import ErrorRateChart from '$lib/progress/components/ErrorRateChart.svelte';
	import BigramTable from '$lib/progress/components/BigramTable.svelte';
	import ClassificationBar from '$lib/progress/components/ClassificationBar.svelte';
	import { isBuiltinCorpusId, loadBuiltinCorpus } from '$lib/corpus/registry';
	import type { FrequencyTable } from '$lib/corpus/types';
	import type { SessionSummary } from '$lib/session/types';
	import type { DiagnosticReport } from '$lib/diagnostic/types';

	// A user could theoretically rack up thousands of sessions. 500 is a soft
	// cap that keeps the chart fast without truncating a realistic history —
	// revisit if the axis becomes illegible.
	const SESSION_CAP = 500;

	/** Mirrors the session routes: English is the fall-back when the profile
	 * is missing or points at a no-longer-supported corpus. */
	const FALLBACK_CORPUS_ID = 'en';

	type LoadState =
		| { status: 'loading' }
		| {
				status: 'ready';
				sessions: SessionSummary[];
				wpm: WpmPoint[];
				errorRate: TrendPoint[];
				bigrams: BigramSummary[];
				/** Most recent diagnostic report, if one exists. */
				currentDiagnostic: DiagnosticReport | null;
				/** Second-most-recent diagnostic report. `null` until a second diagnostic lands. */
				previousDiagnostic: DiagnosticReport | null;
				/**
				 * Bigrams that transitioned into `healthy` between the previous and current
				 * diagnostic. `null` until two diagnostics exist — avoids an ambiguous "0".
				 */
				graduatedCount: number | null;
		  }
		| { status: 'error'; message: string };

	/** Pull the two most recent diagnostic sessions (with attached report),
	 * newest first. We keep the full session (not just the report) because
	 * graduation counts need the underlying bigram aggregates. */
	function pickDiagnosticSessions(sessions: readonly SessionSummary[]): SessionSummary[] {
		return sessions
			.filter((s) => s.type === 'diagnostic' && s.diagnosticReport)
			.sort((a, b) => b.timestamp - a.timestamp)
			.slice(0, 2);
	}

	let state = $state<LoadState>({ status: 'loading' });

	onMount(async () => {
		try {
			const [sessions, profile] = await Promise.all([getRecentSessions(SESSION_CAP), getProfile()]);

			// Corpus load is best-effort: if it fails (e.g. network hiccup on
			// a code-split chunk), we still want the WPM chart to render —
			// `summarizeBigrams` falls back to freq=1 when corpus is absent.
			let corpusFrequencies: FrequencyTable | undefined;
			try {
				const pickedId = profile?.corpusIds?.[0];
				const corpusId = pickedId && isBuiltinCorpusId(pickedId) ? pickedId : FALLBACK_CORPUS_ID;
				const corpus = await loadBuiltinCorpus(corpusId);
				corpusFrequencies = corpus.bigramFrequencies;
			} catch {
				corpusFrequencies = undefined;
			}

			const diagnosticSessions = pickDiagnosticSessions(sessions);
			const [currentSession, previousSession] = diagnosticSessions;
			const graduatedCount =
				currentSession && previousSession
					? countGraduations(previousSession.bigramAggregates, currentSession.bigramAggregates)
					: null;

			state = {
				status: 'ready',
				sessions,
				wpm: buildWpmSeries(sessions),
				errorRate: buildErrorRateSeries(sessions),
				bigrams: summarizeBigrams(sessions, corpusFrequencies),
				currentDiagnostic: currentSession?.diagnosticReport ?? null,
				previousDiagnostic: previousSession?.diagnosticReport ?? null,
				graduatedCount
			};
		} catch (err) {
			state = {
				status: 'error',
				message: err instanceof Error ? err.message : 'Failed to load analytics.'
			};
		}
	});
</script>

<div class="mx-auto max-w-5xl space-y-10">
	<header class="space-y-2">
		<h1 class="text-3xl font-semibold tracking-tight">Analytics</h1>
		<p class="text-base-content/65">WPM trend, bigram breakdown, diagnostic history.</p>
	</header>

	{#if state.status === 'loading'}
		<p class="text-base-content/60">Loading…</p>
	{:else if state.status === 'error'}
		<p class="text-error" role="alert">{state.message}</p>
	{:else}
		<section class="space-y-3" data-testid="wpm-trend">
			<div class="flex items-baseline justify-between">
				<h2 class="text-xl font-semibold">WPM trend</h2>
				<p class="text-sm text-base-content/55">
					{state.sessions.length}
					{state.sessions.length === 1 ? 'session' : 'sessions'}
				</p>
			</div>
			<div class="rounded-lg border border-base-300 bg-base-100 p-4">
				<WpmChart points={state.wpm} />
			</div>
			<p class="text-xs text-base-content/55">
				Dots are individual sessions. The line is a 7-session rolling average; the shaded band is
				±1σ around that average.
			</p>
		</section>

		<section class="space-y-3" data-testid="error-rate-trend">
			<div class="flex items-baseline justify-between">
				<h2 class="text-xl font-semibold">Error rate</h2>
				<p class="text-sm text-base-content/55">Per session</p>
			</div>
			<div class="rounded-lg border border-base-300 bg-base-100 p-4">
				<ErrorRateChart points={state.errorRate} />
			</div>
			<p class="text-xs text-base-content/55">
				Fraction of keystrokes that were first-input errors. The line smooths across 7 sessions.
			</p>
		</section>

		<section class="space-y-3" data-testid="classification-distribution">
			<div class="flex items-baseline justify-between">
				<h2 class="text-xl font-semibold">Classification mix</h2>
			</div>
			{#if state.currentDiagnostic}
				<div class="rounded-lg border border-base-300 bg-base-100 p-4">
					<ClassificationBar
						current={state.currentDiagnostic}
						previous={state.previousDiagnostic}
					/>
				</div>
				{#if state.graduatedCount !== null}
					<p class="text-sm text-base-content/70" data-testid="graduations-delta">
						<!--
							Graduations between consecutive diagnostics is the
							single most motivating number on this page — structural
							change over effort. 0 is meaningful ("none moved to
							healthy this period"), hence we still render instead of
							hiding; only the pre-2-diagnostic state shows a
							placeholder.
						-->
						{#if state.graduatedCount === 0}
							No bigrams graduated to healthy between diagnostics yet — keep going.
						{:else if state.graduatedCount === 1}
							<span class="font-medium text-success">1 bigram</span> graduated to healthy since the previous
							diagnostic.
						{:else}
							<span class="font-medium text-success">{state.graduatedCount} bigrams</span>
							graduated to healthy since the previous diagnostic.
						{/if}
					</p>
				{/if}
				<p class="text-xs text-base-content/55">
					Each segment is a bigram bucket sized by share of the diagnostic. Goal over time: shift
					the bar toward green (healthy).
				</p>
			{:else}
				<p class="text-sm text-base-content/60">
					Run a diagnostic session to see your bigram distribution.
				</p>
			{/if}
		</section>

		<section class="space-y-3" data-testid="bigram-table">
			<div class="flex items-baseline justify-between">
				<h2 class="text-xl font-semibold">Bigram breakdown</h2>
				<p class="text-sm text-base-content/55">
					{state.bigrams.length}
					{state.bigrams.length === 1 ? 'bigram observed' : 'bigrams observed'}
				</p>
			</div>
			<BigramTable rows={state.bigrams} />
			<p class="text-xs text-base-content/55">
				Default sort: priority (badness × corpus frequency). Tap any column to re-sort; tap again to
				flip direction.
			</p>
		</section>
	{/if}
</div>
