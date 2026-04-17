<script lang="ts">
	/**
	 * Dashboard (spec §5 / Phase 6). Reads recent sessions + the latest
	 * diagnostic report, asks the scheduler what to do next, renders the
	 * plan as a stack of quick-start cards. No stat-grid, no placeholder
	 * charts — the spec calls for a single deliberate path forward, not
	 * an analytics cockpit.
	 *
	 * Progress charts and trend sparklines live on `/analytics` (Phase 9).
	 * This page is about "now what?", not "how am I doing over time?".
	 */
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { getRecentSessions } from '$lib/storage/service';
	import { loadBuiltinCorpus } from '$lib/corpus/registry';
	import { loadDashboardData, type DashboardData } from '$lib/scheduler/dashboard-data';
	import { stashPlannedSession } from '$lib/scheduler/handoff';
	import type { PlannedSession } from '$lib/scheduler/types';
	import type { SessionType } from '$lib/session/types';

	/** How many sessions to pull for cadence + diagnostic-lookup decisions. */
	const RECENT_WINDOW = 20;

	type LoadState =
		| { status: 'loading' }
		| { status: 'ready'; data: DashboardData }
		| { status: 'error'; message: string };

	let state = $state<LoadState>({ status: 'loading' });

	onMount(async () => {
		try {
			// Corpus is optional for the planner but enriches the diagnostic
			// report's `corpusFit` — worth the extra few KB.
			const [recentSessions, corpus] = await Promise.all([
				getRecentSessions(RECENT_WINDOW),
				loadBuiltinCorpus('en-top-1000').catch(() => undefined)
			]);
			const data = await loadDashboardData({ recentSessions, corpus });
			state = { status: 'ready', data };
		} catch (err) {
			state = {
				status: 'error',
				message: err instanceof Error ? err.message : 'Failed to load dashboard.'
			};
		}
	});

	/** Route path for a planned session's type. */
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

	function startSession(planned: PlannedSession) {
		// Stash the planned config so the session route can pick up the
		// scheduler's chosen target bigrams / duration. Navigation happens
		// after the stash so the handoff is in place before the route
		// reads it on mount.
		stashPlannedSession(planned);
		window.location.href = routeFor(planned.config.type);
	}

	/** Format the planned word budget for the card headline. */
	function wordsLabel(wordBudget: number): string {
		return `${wordBudget} words`;
	}
</script>

<div class="mx-auto max-w-3xl space-y-12">
	<header class="space-y-3">
		<p class="text-xs font-medium tracking-[0.18em] text-base-content/50 uppercase">
			Typing Trainer · v0.1
		</p>
		<h1 class="text-4xl font-semibold tracking-tight text-base-content">Today's plan</h1>
	</header>

	{#if state.status === 'loading'}
		<p class="text-base-content/60">Loading…</p>
	{:else if state.status === 'error'}
		<p class="text-error" role="alert">{state.message}</p>
	{:else}
		{@const data = state.data}

		{#if data.allDoneForToday}
			<!--
				All mini-sessions done today. Deliberately quiet — no confetti,
				no streak counter (spec §10.4 restricts celebration to structural
				change). The override row below still lets the user run a one-off.
			-->
			<section class="space-y-2" data-testid="day-complete">
				<h2 class="text-2xl font-semibold text-base-content">Today's plan is done.</h2>
				<p class="text-base-content/65">Rest is part of the work. Come back tomorrow.</p>
			</section>
		{/if}

		<!--
			Planned session stack. Each card mirrors the shell's tone: big
			headline, one-line rationale, single primary action. Numbered
			so the user reads them as an ordered pair ("first this, then
			that") rather than two parallel choices.
		-->
		<section class="space-y-4">
			{#each data.plan as planned, i (i)}
				<article
					class="rounded-lg border border-base-300 p-6 transition-colors hover:border-base-content/30"
					data-testid={`plan-card-${planned.reason}`}
				>
					<div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
						<div class="space-y-1">
							<p class="text-xs font-medium tracking-[0.18em] text-base-content/50 uppercase">
								Step {i + 1} · {wordsLabel(planned.config.wordBudget)}
							</p>
							<h2 class="text-2xl font-semibold text-base-content">
								{planned.label}
							</h2>
							{#if planned.rationale}
								<p class="max-w-xl text-sm text-base-content/65">
									{planned.rationale}
								</p>
							{/if}
						</div>
						<button
							type="button"
							class="btn tracking-wide btn-primary"
							onclick={() => startSession(planned)}
							data-testid={`start-${planned.config.type}`}
						>
							Start →
						</button>
					</div>

					{#if planned.config.bigramsTargeted && planned.config.bigramsTargeted.length > 0}
						<!--
							Target chips: the transparent version of "what the
							planner picked for you today". Helpful when the user
							wonders *why* a drill feels easier/harder on any given
							day. Also makes the graduated-rotation rule's output
							inspectable at a glance.
						-->
						<ul class="mt-4 flex flex-wrap gap-1.5" aria-label="Drill targets">
							{#each planned.config.bigramsTargeted as bigram (bigram)}
								<li
									class="rounded-sm bg-base-200 px-2 py-0.5 font-mono text-xs text-base-content/80"
								>
									{bigram}
								</li>
							{/each}
						</ul>
					{/if}
				</article>
			{/each}
		</section>

		<!--
			Override row. The planner's choice is right most of the time, but
			the user can always drop into a specific session kind — spec §5
			leaves "or on demand" explicit for diagnostics.
		-->
		<section class="flex flex-wrap items-center gap-3 border-t border-base-300 pt-6 text-sm">
			<p class="text-base-content/55">Or run something specific:</p>
			<a
				href={resolve('/session/diagnostic')}
				class="btn btn-ghost btn-sm"
				data-testid="override-diagnostic"
			>
				Diagnostic
			</a>
			<a
				href={resolve('/session/bigram-drill')}
				class="btn btn-ghost btn-sm"
				data-testid="override-drill"
			>
				Drill
			</a>
			<a
				href={resolve('/session/real-text')}
				class="btn btn-ghost btn-sm"
				data-testid="override-realtext"
			>
				Real text
			</a>
		</section>

		{#if data.lastSession}
			<section
				class="flex flex-wrap items-baseline gap-x-6 gap-y-2 border-t border-base-300 pt-6 text-sm"
			>
				<p class="text-base-content/55">Last session</p>
				<p class="font-mono text-base-content/90 tabular-nums">
					{data.lastSession.wpm.toFixed(1)}<span class="text-base-content/40"> WPM</span>
				</p>
				<p class="font-mono text-base-content/90 tabular-nums">
					{(data.lastSession.errorRate * 100).toFixed(1)}<span class="text-base-content/40">
						% err</span
					>
				</p>
				<a
					href={resolve('/session/[id]/summary', { id: data.lastSession.id })}
					class="ml-auto text-base-content/60 underline-offset-4 hover:text-base-content hover:underline"
				>
					See details →
				</a>
			</section>
		{/if}
	{/if}
</div>
