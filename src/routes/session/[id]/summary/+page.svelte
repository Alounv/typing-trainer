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
	import { loadSummaryContext } from '$lib/session/summary-loader';
	import type { SessionSummary, SessionType } from '$lib/session/types';
	import type { BigramAggregate } from '$lib/bigram/types';
	import { loadDashboardData } from '$lib/practice/dashboard-loader';
	import { stashPlannedSession } from '$lib/session/planned';
	import { activateBonusRound } from '$lib/practice/bonus-round';
	import type { PlannedSession } from '$lib/practice/types';
	import { computeSessionDelta, type SessionDelta as SessionDeltaModel } from '$lib/session/delta';
	import SessionDelta from '$lib/session/components/SessionDelta.svelte';
	import {
		detectGraduations,
		detectMilestone,
		type GraduationEvent,
		type MilestoneEvent
	} from '$lib/progress/celebrations';
	import Graduations from '$lib/session/components/Graduations.svelte';
	import MilestoneBanner from '$lib/session/components/MilestoneBanner.svelte';
	import { DEFAULT_HIGH_ERROR_THRESHOLD } from '$lib/bigram/classification';

	/**
	 * Traffic-light threshold for the error-rate hero. The high-error cutoff
	 * comes from the same constant the classifier uses (5% by default); the
	 * "warn" step is the midpoint between clean (0%) and the cutoff so a
	 * user hovering just below the floor gets a yellow nudge rather than a
	 * misleading green.
	 */
	const ERROR_WARN_THRESHOLD = DEFAULT_HIGH_ERROR_THRESHOLD / 2;

	/** Map error rate → DaisyUI semantic colour class for the hero number. */
	function errorRateColour(rate: number): string {
		if (rate > DEFAULT_HIGH_ERROR_THRESHOLD) return 'text-error';
		if (rate > ERROR_WARN_THRESHOLD) return 'text-warning';
		return 'text-success';
	}

	type LoadState =
		| { status: 'loading' }
		| {
				status: 'ready';
				summary: SessionSummary;
				/** Post-session delta vs recent history. Null only when `computeSessionDelta` is skipped (never today, but defensive). */
				delta: SessionDeltaModel;
				/** Bigram-level threshold crossings to celebrate this session. Empty when nothing graduated. */
				graduations: GraduationEvent[];
				/** WPM milestone crossed this session, or `null` when none. */
				milestone: MilestoneEvent | null;
				next: PlannedSession | undefined;
				/** Snapshot for `activateBonusRound` when the user starts another round from here. */
				completedToday: Partial<Record<SessionType, number>>;
		  }
		| { status: 'missing' }
		| { status: 'error'; message: string };

	let state = $state<LoadState>({ status: 'loading' });

	onMount(async () => {
		try {
			// Load the session + recent history. The history feeds the planner
			// (so the first remaining plan item *is* the real "what's next"),
			// the delta, graduation detection, and milestone detection — one
			// fetch shared across four consumers.
			const { session: summary, recentSessions } = await loadSummaryContext(page.params.id!);
			if (!summary) {
				state = { status: 'missing' };
				return;
			}
			const dashboard = await loadDashboardData({ recentSessions });
			// `recentSessions` contains the just-saved session; `computeSessionDelta`
			// excludes it internally when building the baseline so we don't need to
			// pre-filter here.
			const delta = computeSessionDelta(summary, recentSessions);
			// Previous session for graduation comparison — most recent prior session
			// with bigram data. Mirrors the rule used inside `computeSessionDelta`
			// so the "bigrams graduated" count and the itemised list agree.
			const prevWithBigrams =
				recentSessions
					.filter((s) => s.id !== summary.id && s.bigramAggregates.length > 0)
					.sort((a, b) => b.timestamp - a.timestamp)[0] ?? null;
			const graduations = detectGraduations(
				prevWithBigrams ? prevWithBigrams.bigramAggregates : null,
				summary.bigramAggregates
			);
			// Milestone detection runs on the smoothed WPM series — `detectMilestone`
			// filters out `summary` from `recentSessions` internally and re-appends
			// it, so passing the full recent window is safe.
			const milestone = detectMilestone(summary, recentSessions);
			state = {
				status: 'ready',
				summary,
				delta,
				graduations,
				milestone,
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
	 * Space-bar shortcut: trigger the primary CTA (next session if planned,
	 * otherwise back to dashboard). Mirrors the "spacebar advances" reflex
	 * built up during typing sessions — the user's hand is already there.
	 *
	 * Ignored when a form field or the theme dropdown has focus so we don't
	 * hijack native inputs. We also skip modifier combos (`ctrl+space`,
	 * `shift+space`, `meta+space`) to avoid clashing with OS shortcuts.
	 */
	function onWindowKeydown(event: KeyboardEvent) {
		if (state.status !== 'ready') return;
		if (event.key !== ' ' && event.code !== 'Space') return;
		if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;

		// Don't steal space from inputs / buttons the user may be interacting with.
		const el = document.activeElement;
		if (el instanceof HTMLElement) {
			const tag = el.tagName;
			if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable) {
				return;
			}
		}

		event.preventDefault();
		if (state.next) {
			startNext(state.next);
		} else {
			window.location.href = resolve('/');
		}
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

<svelte:window onkeydown={onWindowKeydown} />

<div class="mx-auto max-w-3xl space-y-10">
	<header class="flex items-baseline justify-between gap-4">
		<h1 class="text-4xl font-bold tracking-tight">Session summary</h1>
		{#if state.status === 'ready'}
			<p class="text-xs font-medium tracking-[0.18em] text-base-content/50 uppercase">
				<kbd
					class="rounded-sm border border-base-300 bg-base-200 px-1.5 py-0.5 font-mono text-[0.65rem] tracking-normal text-base-content/70"
					>Space</kbd
				>
				{state.next ? 'next session' : 'dashboard'}
			</p>
		{/if}
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
			Milestone banner — renders above the hero metric so a threshold
			crossing is the first thing the user sees. Self-guards on null;
			mount unconditionally.
		-->
		<MilestoneBanner event={state.milestone} />

		<!--
			Hero metrics: WPM and error rate are co-equal headlines — speed
			without accuracy is meaningless, and vice versa, so they share the
			same visual weight. The error number is traffic-lit (green below
			the warn threshold, yellow between warn and the high-error floor,
			red above the floor) — keeps the number meaningful at a glance.
		-->
		<section class="space-y-4">
			<dl class="grid gap-6" style="grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));">
				<div class="space-y-2">
					<dt class="text-xs font-medium tracking-[0.18em] text-base-content/50 uppercase">
						Raw WPM
					</dt>
					<dd
						class="font-mono text-7xl leading-none font-medium text-base-content tabular-nums"
						data-testid="wpm-value"
					>
						{s.wpm.toFixed(1)}
					</dd>
					<dd class="text-sm text-base-content/60">Not smoothed — first-pass reading</dd>
				</div>
				<div class="space-y-2">
					<dt class="text-xs font-medium tracking-[0.18em] text-base-content/50 uppercase">
						Errors
					</dt>
					<dd
						class={`font-mono text-7xl leading-none font-medium tabular-nums ${errorRateColour(s.errorRate)}`}
						data-testid="error-rate-value"
					>
						{(s.errorRate * 100).toFixed(1)}%
					</dd>
					<dd class="text-sm text-base-content/60">First-input only — backspace doesn't erase</dd>
				</div>
			</dl>
		</section>

		<SessionDelta delta={state.delta} />

		<Graduations events={state.graduations} />

		<!--
			Slowest bigrams as tiles, not a table. The bigram glyph itself is
			the subject; ms is supporting caption. Auto-fit grid caps tile
			width so a small sample set doesn't stretch into stadium-sized
			cards. No card shadows — flat surfaces tied together by a common
			border color, no generic drop-shadow tell.
		-->
		<!--
			Slowest transitions as a hairline-ruled list, not a tile grid. Each
			row reads like a lab sheet: the bigram leads, a mono mean-time sits
			in a fixed column, and a terminal status tag ("clean" / "N% err")
			closes the row. Rule-separated rows keep the instrument aesthetic
			and avoid the identical-card-grid tell.
		-->
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
								<span class="text-xs tracking-[0.18em] text-base-content/40 uppercase">
									Clean
								</span>
							{/if}
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
				<a href={resolve('/')} class="btn btn-lg btn-primary" data-testid="day-complete-cta"
					>Day complete · Back to dashboard</a
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
