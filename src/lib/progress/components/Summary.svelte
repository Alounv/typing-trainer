<script lang="ts">
	import type { SessionSummary } from '$lib/support/core';
	import { DEFAULT_HIGH_ERROR_THRESHOLD } from '$lib/support/core';
	import { computeSessionDelta } from '../delta';
	import { detectMovements, detectMilestone } from '../celebrations';
	import SessionDelta from './SessionDelta.svelte';
	import BigramMovements from './BigramMovements.svelte';
	import MilestoneBanner from './MilestoneBanner.svelte';

	interface Props {
		session: SessionSummary;
		/** Recent window including the current session — delta filters `session` out internally. */
		recentSessions: readonly SessionSummary[];
	}

	let { session, recentSessions }: Props = $props();

	const delta = $derived(computeSessionDelta(session, recentSessions));
	const milestone = $derived(detectMilestone(session, recentSessions));

	// Mirrors the rule inside `computeSessionDelta` so the list compares against
	// the same prior session.
	const movements = $derived.by(() => {
		const prevWithBigrams =
			recentSessions
				.filter((s) => s.id !== session.id && s.bigramAggregates.length > 0)
				.sort((a, b) => b.timestamp - a.timestamp)[0] ?? null;
		return detectMovements(
			prevWithBigrams ? prevWithBigrams.bigramAggregates : null,
			session.bigramAggregates
		);
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
