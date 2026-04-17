<script lang="ts">
	/**
	 * Walking-skeleton summary page (Phase 2.5). Loads the session from Dexie
	 * and shows the three numbers the spec calls for at this stage: raw WPM,
	 * error count, top-5 slowest character-pair transitions.
	 *
	 * Loading happens in `onMount` rather than a `+page.ts` load — Dexie is
	 * client-only (IndexedDB), and SvelteKit's static adapter would try to
	 * prerender a load function. Client-only fetch keeps this SPA-friendly.
	 */
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { getSession, getRecentSessions } from '$lib/storage/service';
	import type { SessionSummary, SessionType } from '$lib/session/types';
	import type { BigramAggregate } from '$lib/bigram/types';
	import { loadBuiltinCorpus } from '$lib/corpus/registry';
	import { loadDashboardData } from '$lib/scheduler/dashboard-data';
	import { stashPlannedSession } from '$lib/scheduler/handoff';
	import { activateBonusRound } from '$lib/scheduler/bonus-round';
	import type { PlannedSession } from '$lib/scheduler/types';

	type LoadState =
		| { status: 'loading' }
		| {
				status: 'ready';
				summary: SessionSummary;
				next: PlannedSession | undefined;
				/** Snapshot for `activateBonusRound` when the user starts another round from here. */
				completedToday: Partial<Record<SessionType, number>>;
		  }
		| { status: 'missing' }
		| { status: 'error'; message: string };

	let state = $state<LoadState>({ status: 'loading' });

	/** Matches the dashboard's recent-session window; the planner only peeks a few. */
	const RECENT_WINDOW = 20;

	onMount(async () => {
		try {
			// Load the session + re-run the planner in parallel. The planner
			// sees the just-completed session (it's in recentSessions) so the
			// first remaining plan item *is* the real "what's next".
			const [summary, recentSessions, corpus] = await Promise.all([
				getSession(page.params.id!),
				getRecentSessions(RECENT_WINDOW),
				loadBuiltinCorpus('en-top-1000').catch(() => undefined)
			]);
			if (!summary) {
				state = { status: 'missing' };
				return;
			}
			const dashboard = await loadDashboardData({ recentSessions, corpus });
			state = {
				status: 'ready',
				summary,
				next: dashboard.plan[0],
				completedToday: dashboard.completedToday
			};
		} catch (err) {
			state = {
				status: 'error',
				message: err instanceof Error ? err.message : 'Unknown error'
			};
		}
	});

	/** Route path for a planned session's type (mirrors the dashboard). */
	function routeFor(type: SessionType): string {
		switch (type) {
			case 'diagnostic':
				return resolve('/session/diagnostic');
			case 'bigram-drill':
				return resolve('/session/bigram-drill');
			case 'real-text':
				return resolve('/session/real-text');
		}
	}

	function startNext(planned: PlannedSession) {
		// Same handoff pattern the dashboard uses: stash the config so the
		// session route can read its targets / word budget on mount.
		stashPlannedSession(planned);
		window.location.href = routeFor(planned.config.type);
	}

	function startAnotherRound(completedToday: Partial<Record<SessionType, number>>) {
		// Mirrors the dashboard's "Start another round" button: snapshot
		// today's completions as the new baseline, then land on the
		// dashboard where the freshly-re-planned pair of cards is waiting.
		activateBonusRound(completedToday);
		window.location.href = resolve('/');
	}

	/**
	 * Slowest-5 bigrams by `meanTime`. Filters out `NaN` — those are bigrams
	 * where every occurrence had a first-input error somewhere in the pair,
	 * so there's no clean timing signal to rank by.
	 */
	function slowestFive(aggregates: readonly BigramAggregate[]): BigramAggregate[] {
		return aggregates
			.filter((a) => Number.isFinite(a.meanTime))
			.toSorted((a, b) => b.meanTime - a.meanTime)
			.slice(0, 5);
	}
</script>

<div class="mx-auto max-w-3xl space-y-10">
	<header>
		<h1 class="text-4xl font-bold tracking-tight">Session summary</h1>
	</header>

	{#if state.status === 'loading'}
		<p class="text-base-content/70">Loading…</p>
	{:else if state.status === 'missing'}
		<p class="text-base-content/70" role="alert">
			No session found for this id. It may have been cleared.
		</p>
	{:else if state.status === 'error'}
		<p class="text-error" role="alert">Couldn't load session: {state.message}</p>
	{:else}
		{@const s = state.summary}
		{@const slowest = slowestFive(s.bigramAggregates)}

		<!--
			Hero metric treatment: WPM is the headline; error rate and duration
			are supporting chips. Deliberately replaces the three-equal-boxes
			daisyUI `stats` template — a session ends on one number, not three.
			Numeric displays are mono + `tabular-nums` so digit widths stay
			stable (matters when these update from re-renders or retakes).
		-->
		<section class="space-y-3">
			<p class="text-xs font-medium tracking-[0.18em] text-base-content/50 uppercase">Raw WPM</p>
			<p
				class="font-mono text-7xl leading-none font-medium text-base-content tabular-nums"
				data-testid="wpm-value"
			>
				{s.wpm.toFixed(1)}
			</p>
			<p class="text-sm text-base-content/60">Not smoothed — first-pass reading</p>

			<dl class="flex flex-wrap gap-x-6 gap-y-2 pt-3 text-sm">
				<div class="flex items-baseline gap-2">
					<dt class="text-base-content/55">Errors</dt>
					<dd class="font-mono font-medium text-base-content/90 tabular-nums">
						{(s.errorRate * 100).toFixed(1)}%
					</dd>
				</div>
				<div class="flex items-baseline gap-2">
					<dt class="text-base-content/55">Duration</dt>
					<dd class="font-mono font-medium text-base-content/90 tabular-nums">
						{(s.durationMs / 1000).toFixed(1)}s
					</dd>
				</div>
			</dl>
		</section>

		<!--
			Slowest bigrams as tiles, not a table. The bigram glyph itself is
			the subject; ms is supporting caption. Auto-fit grid caps tile
			width so a small sample set doesn't stretch into stadium-sized
			cards. No card shadows — flat surfaces tied together by a common
			border color, no generic drop-shadow tell.
		-->
		<section class="space-y-4">
			<div class="flex items-baseline justify-between">
				<h2 class="text-xl font-semibold tracking-tight">Slowest transitions</h2>
				<p class="text-xs tracking-wide text-base-content/50 uppercase">Top 5 by mean time</p>
			</div>
			{#if slowest.length === 0}
				<p class="text-base-content/70">
					No clean bigram samples yet — need at least one error-free adjacent pair.
				</p>
			{:else}
				<ul
					class="grid gap-3"
					style="grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr));"
					data-testid="slowest-tiles"
				>
					{#each slowest as b (b.bigram)}
						<li
							class="flex flex-col gap-2 rounded-md border border-base-300 bg-base-200/60 px-4 py-3"
						>
							<span
								class="font-mono text-2xl leading-none tracking-wide text-base-content"
								aria-label={`bigram ${b.bigram}`}
							>
								{b.bigram === ' ' ? '␣' : b.bigram.replace(/ /g, '␣')}
							</span>
							<div class="flex items-baseline justify-between text-xs">
								<span class="font-mono text-base-content/80 tabular-nums">
									{b.meanTime.toFixed(0)}<span class="text-base-content/40"> ms</span>
								</span>
								{#if b.errorRate > 0}
									<span class="font-mono text-error tabular-nums">
										{(b.errorRate * 100).toFixed(0)}%
									</span>
								{:else}
									<span class="text-base-content/40">clean</span>
								{/if}
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		<!--
			Single prominent CTA. When there's a next planned session, this
			routes straight into it (same handoff as the dashboard); when
			today's plan is exhausted, we fall back to "Back to dashboard"
			as the primary action — there's no sensible "next" to push.
		-->
		<div class="flex flex-wrap items-center gap-6 pt-2">
			{#if state.next}
				{@const next = state.next}
				<button
					type="button"
					class="btn btn-lg btn-primary"
					onclick={() => startNext(next)}
					data-testid="next-session"
				>
					Next session: {next.label} →
				</button>
				<a
					href={resolve('/')}
					class="text-sm text-base-content/60 underline-offset-4 hover:text-base-content hover:underline"
				>
					Back to dashboard
				</a>
			{:else}
				{@const completed = state.completedToday}
				<a
					href={resolve('/')}
					class="btn btn-lg btn-primary"
					data-testid="day-complete-cta">Day complete · Back to dashboard</a
				>
				<button
					type="button"
					class="text-sm text-base-content/60 underline-offset-4 hover:text-base-content hover:underline"
					onclick={() => startAnotherRound(completed)}
					data-testid="summary-start-another-round"
				>
					Start another round
				</button>
			{/if}
		</div>
	{/if}
</div>
