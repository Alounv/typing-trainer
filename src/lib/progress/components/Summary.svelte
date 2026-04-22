<script lang="ts">
	import type { BigramAggregate, SessionSummary } from '$lib/support/core';
	import { DEFAULT_HIGH_ERROR_THRESHOLD } from '$lib/support/core';
	import { computeSessionDelta } from '../delta';
	import { detectGraduations, detectMilestone } from '../celebrations';
	import SessionDelta from './SessionDelta.svelte';
	import Graduations from './Graduations.svelte';
	import MilestoneBanner from './MilestoneBanner.svelte';

	interface Props {
		session: SessionSummary;
		/** Recent window including the current session — delta filters `session` out internally. */
		recentSessions: readonly SessionSummary[];
	}

	let { session, recentSessions }: Props = $props();

	const delta = $derived(computeSessionDelta(session, recentSessions));
	const milestone = $derived(detectMilestone(session, recentSessions));

	// Mirrors the rule inside `computeSessionDelta` so the sentence and the list
	// agree on which prior session they're comparing against.
	const graduations = $derived.by(() => {
		const prevWithBigrams =
			recentSessions
				.filter((s) => s.id !== session.id && s.bigramAggregates.length > 0)
				.sort((a, b) => b.timestamp - a.timestamp)[0] ?? null;
		return detectGraduations(
			prevWithBigrams ? prevWithBigrams.bigramAggregates : null,
			session.bigramAggregates
		);
	});

	// Traffic-light threshold: green below warn, yellow between, red above the high-error floor.
	const ERROR_WARN_THRESHOLD = DEFAULT_HIGH_ERROR_THRESHOLD / 2;
	function errorRateColour(rate: number): string {
		if (rate > DEFAULT_HIGH_ERROR_THRESHOLD) return 'text-error';
		if (rate > ERROR_WARN_THRESHOLD) return 'text-warning';
		return 'text-success';
	}

	/** Slowest-5 by mean time. NaN means every occurrence had a first-input error somewhere in the pair. */
	function slowestFive(aggregates: readonly BigramAggregate[]): BigramAggregate[] {
		return aggregates
			.filter((a) => Number.isFinite(a.meanTime))
			.toSorted((a, b) => b.meanTime - a.meanTime)
			.slice(0, 5);
	}

	const slowest = $derived(slowestFive(session.bigramAggregates));
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

<Graduations events={graduations} />

<section class="space-y-4">
	<div class="flex items-baseline justify-between">
		<h2 class="text-xl font-semibold tracking-tight">Slowest transitions</h2>
		<p class="text-xs font-medium tracking-[0.18em] text-base-content/50 uppercase">
			Top 5 · mean time
		</p>
	</div>
	{#if slowest.length === 0}
		<p class="text-sm text-base-content/65">
			No clean bigram samples yet — need at least one error-free adjacent pair.
		</p>
	{:else}
		<ul class="divide-y divide-base-300 border-y border-base-300" data-testid="slowest-tiles">
			{#each slowest as b (b.bigram)}
				<li class="grid grid-cols-[auto_1fr_auto] items-baseline gap-6 py-3">
					<span
						class="font-mono text-xl tracking-wide text-base-content"
						aria-label={`bigram ${b.bigram}`}
					>
						{b.bigram === ' ' ? '␣' : b.bigram.replace(/ /g, '␣')}
					</span>
					<span class="font-mono text-sm text-base-content/80 tabular-nums">
						{b.meanTime.toFixed(0)}<span class="text-base-content/40"> ms</span>
					</span>
					{#if b.errorRate > 0}
						<span class="font-mono text-xs tracking-[0.18em] text-error uppercase tabular-nums">
							{(b.errorRate * 100).toFixed(0)}% err
						</span>
					{:else}
						<span class="text-xs tracking-[0.18em] text-base-content/40 uppercase">Clean</span>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</section>
