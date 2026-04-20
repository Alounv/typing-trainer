<script lang="ts">
	/**
	 * Dashboard. Reads recent sessions + latest diagnostic, asks the scheduler
	 * what to do next, renders the plan as quick-start cards. Progress charts
	 * and sparklines live on `/analytics` — this page is "now what?", not trends.
	 */
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import {
		loadDashboardData,
		planSlotKey,
		startFreshPlan,
		startPlannedSession,
		type DashboardData,
		type PlanSlotKey
	} from '$lib/practice';

	type LoadState =
		| { status: 'loading' }
		| { status: 'ready'; data: DashboardData }
		| { status: 'error'; message: string };

	let state = $state<LoadState>({ status: 'loading' });

	// Script-level `$derived` for the debug panel — `<details>` can't host
	// `{@const}` in Svelte 5.
	const debugConsumed = $derived.by<boolean[]>(() =>
		state.status === 'ready' ? consumedByKey(state.data.fullPlan, state.data.completedToday) : []
	);

	onMount(async () => {
		try {
			const data = await loadDashboardData();
			state = { status: 'ready', data };
		} catch (err) {
			state = {
				status: 'error',
				message: err instanceof Error ? err.message : 'Failed to load dashboard.'
			};
		}
	});

	/** Format the planned word budget for the card headline. */
	function wordsLabel(wordBudget: number): string {
		return `${wordBudget} words`;
	}

	/** Per-position slicer trace for the debug panel. */
	function consumedByKey(
		fullPlan: DashboardData['fullPlan'],
		completed: Partial<Record<PlanSlotKey, number>>
	): boolean[] {
		const remaining: Partial<Record<PlanSlotKey, number>> = { ...completed };
		return fullPlan.map((planned) => {
			const key = planSlotKey(planned.config);
			const left = remaining[key] ?? 0;
			if (left > 0) {
				remaining[key] = left - 1;
				return true;
			}
			return false;
		});
	}
</script>

<div class="mx-auto max-w-3xl space-y-12">
	<header class="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
		<div class="space-y-3">
			<p class="text-xs font-medium tracking-[0.18em] text-base-content/50 uppercase">
				Typing Trainer · v0.1
			</p>
			<h1 class="text-4xl font-semibold tracking-tight text-base-content">Today's plan</h1>
		</div>
		<!-- Bump the plan-window cursor to now → fresh plan on next load. -->
		<button
			type="button"
			class="text-sm text-base-content/60 underline-offset-4 hover:text-base-content hover:underline"
			data-testid="restart-plan"
			onclick={() => startFreshPlan()}
		>
			Start fresh plan →
		</button>
	</header>

	{#if state.status === 'loading'}
		<p class="text-base-content/60">Loading…</p>
	{:else if state.status === 'error'}
		<p class="text-error" role="alert">{state.message}</p>
	{:else}
		{@const data = state.data}

		{#if data.allDoneForToday}
			<!--
				Day done. Deliberately quiet — celebration is reserved for
				structural change. The "Start fresh plan" button in the header
				is the escape hatch for anyone who wants to keep practising.
			-->
			<section class="space-y-3" data-testid="day-complete">
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
							onclick={() => startPlannedSession(planned)}
							data-testid={`start-${planned.config.type}`}
						>
							Start →
						</button>
					</div>

					{#if planned.config.bigramsTargeted && planned.config.bigramsTargeted.length > 0}
						<!-- Target chips — two styles when mix includes exposure backfill. -->
						{@const exposureSet = new Set(planned.drillMix?.exposure ?? [])}
						{@const mixed =
							exposureSet.size > 0 &&
							planned.config.bigramsTargeted.some((b) => !exposureSet.has(b))}
						<ul class="mt-4 flex flex-wrap gap-1.5" aria-label="Drill targets">
							{#each planned.config.bigramsTargeted as bigram (bigram)}
								{@const isExposure = exposureSet.has(bigram)}
								<li
									class="rounded-sm px-2 py-0.5 font-mono text-xs {isExposure
										? 'border border-dashed border-base-content/40 text-base-content/60'
										: 'bg-base-200 text-base-content/80'}"
									aria-label={isExposure
										? `${bigram}, new bigram for exposure practice`
										: `${bigram}, diagnosed weakness`}
								>
									{bigram}
								</li>
							{/each}
						</ul>
						{#if mixed}
							<p class="mt-2 text-[11px] text-base-content/50">
								<span
									class="mr-1 inline-block rounded-sm bg-base-200 px-1.5 py-0.5 align-middle font-mono text-base-content/80"
									>ab</span
								>
								diagnosed weakness ·
								<span
									class="mx-1 inline-block rounded-sm border border-dashed border-base-content/40 px-1.5 py-0.5 align-middle font-mono text-base-content/60"
									>cd</span
								>
								new bigram — not enough data yet
							</p>
						{/if}
					{/if}
				</article>
			{/each}
		</section>

		<!-- Override row: planner's usually right, but user can drop into a specific kind. -->
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
				href={resolve('/session/accuracy-drill')}
				class="btn btn-ghost btn-sm"
				data-testid="override-accuracy-drill"
			>
				Accuracy drill
			</a>
			<a
				href={resolve('/session/speed-drill')}
				class="btn btn-ghost btn-sm"
				data-testid="override-speed-drill"
			>
				Speed drill
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

		<!-- Temporary debug panel — rip out once the plan-accounting regression is settled. -->
		<details
			class="mt-12 rounded-md border border-dashed border-base-content/30 px-4 py-2 text-xs"
			data-testid="debug-panel"
		>
			<summary class="cursor-pointer font-mono tracking-wide text-base-content/60 uppercase"
				>Debug · planner inputs</summary
			>
			<div class="mt-3 space-y-3 font-mono text-[11px] text-base-content/80">
				<!-- Strike-through = slicer-consumed by key match (not positional). -->
				<div>
					<p class="text-base-content/55">
						Full plan ({data.fullPlan.length}) → remaining ({data.plan.length}):
					</p>
					<ol class="ml-4 list-decimal space-y-0.5">
						{#each data.fullPlan as planned, i (i)}
							<li
								class={debugConsumed[i] ? 'text-base-content/35 line-through' : 'text-base-content'}
							>
								{planSlotKey(planned.config)}
							</li>
						{/each}
					</ol>
				</div>

				<div>
					<p class="text-base-content/55">Completed since cutoff (by slot-key):</p>
					<pre class="ml-4 whitespace-pre-wrap">{JSON.stringify(data.completedToday, null, 2)}</pre>
				</div>

				<div>
					<p class="text-base-content/55">
						Plan-window cursor:
						{data.planStartedAt
							? new Date(data.planStartedAt).toLocaleTimeString()
							: 'none (using start-of-day)'}
					</p>
				</div>

				{#if data.latestDiagnosticReport}
					{@const report = data.latestDiagnosticReport}
					<div>
						<p class="text-base-content/55">
							Latest diagnostic · baseline {report.baselineWPM.toFixed(1)} → target {report.targetWPM.toFixed(
								1
							)} WPM
						</p>
						<p class="ml-4">
							counts: {JSON.stringify(report.counts)}
						</p>
						<p class="ml-4">
							priorityTargets ({report.priorityTargets.length}):
							{report.priorityTargets
								.slice(0, 10)
								.map((p) => `${p.bigram}·${p.classification}`)
								.join(', ')}
						</p>
					</div>
				{:else}
					<p class="text-base-content/55">No diagnostic report yet.</p>
				{/if}

				<div>
					<p class="text-base-content/55">
						Graduated from rotation ({data.graduatedFromRotation.size}):
					</p>
					<p class="ml-4">
						{[...data.graduatedFromRotation].join(', ') || '—'}
					</p>
				</div>
			</div>
		</details>
	{/if}
</div>
