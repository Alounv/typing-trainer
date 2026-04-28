<script lang="ts">
	import type { SessionSummary } from '$lib/support/core';
	import { DEFAULT_HIGH_ERROR_THRESHOLD } from '$lib/support/core';
	import type { FrequencyTable } from '$lib/corpus';
	import { summarizeBigrams } from '$lib/skill';
	import { computeSessionDelta } from '../delta';
	import { detectWindowedMovements, detectMilestone } from '../celebrations';
	import { buildBigramTrend } from '../metrics';
	import SessionDelta from './SessionDelta.svelte';
	import BigramMovements from './BigramMovements.svelte';
	import MilestoneBanner from './MilestoneBanner.svelte';
	import BigramTable from './BigramTable.svelte';

	interface Props {
		session: SessionSummary;
		/** Recent window including the current session — delta filters `session` out internally. */
		recentSessions: readonly SessionSummary[];
		/**
		 * Wider session window for the drilled-bigram table. Uses the same 500-cap as Analytics
		 * so the 10-occurrence stats window can fill for rare bigrams.
		 */
		statsSessions?: readonly SessionSummary[];
		corpusFrequencies?: FrequencyTable | undefined;
	}

	let {
		session,
		recentSessions,
		statsSessions = recentSessions,
		corpusFrequencies = undefined
	}: Props = $props();

	const delta = $derived(computeSessionDelta(session, recentSessions));
	const milestone = $derived(detectMilestone(session, recentSessions));

	const drilledBigrams = $derived(session.bigramsTargeted ?? []);
	const drilledRows = $derived.by(() => {
		if (drilledBigrams.length === 0) return [];
		const targeted = new Set(drilledBigrams);
		const summaries = summarizeBigrams(statsSessions, corpusFrequencies);
		return summaries
			.filter((row) => targeted.has(row.bigram))
			.map((row) => ({ ...row, trend: buildBigramTrend(statsSessions, row.bigram) }));
	});

	// Compare windowed classifications before vs. after this session so movements
	// reflect the user's overall standing — same view as the bigram table — rather
	// than a single noisy session's per-session classification. For drill sessions
	// the list is scoped to the drilled bigrams to stay aligned with the table
	// below; non-drill sessions surface all movements.
	const movements = $derived.by(() => {
		const all = detectWindowedMovements(statsSessions, session.id);
		if (drilledBigrams.length === 0) return all;
		const targeted = new Set(drilledBigrams);
		return all.filter((m) => targeted.has(m.bigram));
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

<SessionDelta {delta} />

<BigramMovements events={movements} />

{#if drilledRows.length > 0}
	<section class="space-y-3" data-testid="drilled-bigrams-table">
		<div class="flex items-baseline justify-between">
			<h2 class="text-xl font-semibold">Drilled bigrams</h2>
			<p class="text-sm text-base-content/55">
				{drilledRows.length}
				{drilledRows.length === 1 ? 'bigram' : 'bigrams'} targeted
			</p>
		</div>
		<BigramTable rows={drilledRows} />
		<p class="text-xs text-base-content/55">
			Stats span the last 10 occurrences across all sessions — same as the Analytics page.
		</p>
	</section>
{/if}
