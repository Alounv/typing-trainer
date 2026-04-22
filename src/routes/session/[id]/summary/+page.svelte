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
	import { loadSummaryContext, type SummaryViewModel } from './loader';
	import { startPlannedSession, startFreshPlan } from '$lib/plan';
	import type { BigramAggregate, SessionSummary } from '$lib/core';
	import { DEFAULT_HIGH_ERROR_THRESHOLD } from '$lib/core';
	import SessionDelta from '$lib/progress/components/SessionDelta.svelte';
	import Graduations from '$lib/progress/components/Graduations.svelte';
	import MilestoneBanner from '$lib/progress/components/MilestoneBanner.svelte';

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

	// The loader supplies everything but the async-lifecycle flags. Keep
	// `loading` / `error` local — they describe the onMount call itself, not
	// the view-model's domain state.
	type LoadState = { status: 'loading' } | { status: 'error'; message: string } | SummaryViewModel;

	let state = $state<LoadState>({ status: 'loading' });

	onMount(async () => {
		try {
			state = await loadSummaryContext(page.params.id!);
		} catch (err) {
			state = {
				status: 'error',
				message: err instanceof Error ? err.message : 'Unknown error'
			};
		}
	});

	/**
	 * Enter-key shortcut: trigger the primary CTA (next session if planned,
	 * otherwise back to dashboard). Enter reads as "confirm / proceed" and
	 * avoids the typo hazard of Space — after a drill the user's hands are
	 * still resting on the home row, and a stray spacebar press would
	 * otherwise advance before they've read the summary.
	 *
	 * Ignored when a form field or the theme dropdown has focus so we don't
	 * hijack native inputs. We also skip modifier combos to avoid clashing
	 * with OS shortcuts.
	 */
	function onWindowKeydown(event: KeyboardEvent) {
		if (state.status !== 'ready') return;
		if (event.key !== 'Enter' && event.code !== 'Enter') return;
		if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;

		// Don't steal Enter from inputs / buttons the user may be interacting with.
		const el = document.activeElement;
		if (el instanceof HTMLElement) {
			const tag = el.tagName;
			if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable) {
				return;
			}
		}

		event.preventDefault();
		if (state.next) {
			startPlannedSession(state.next);
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

	/**
	 * Human label for the session the user just finished. Drills split by mode
	 * (accuracy / speed) because post-treatment the user cares which regimen
	 * they ran — the WPM/errors numbers read differently under each. Legacy
	 * drill sessions (no `drillMode` on the summary) collapse to the generic
	 * "Bigram drill" so old storage records still render cleanly.
	 */
	function sessionTypeLabel(s: SessionSummary): string {
		if (s.type === 'diagnostic') return 'Diagnostic';
		if (s.type === 'real-text') return 'Real text';
		if (s.drillMode === 'accuracy') return 'Accuracy drill';
		if (s.drillMode === 'speed') return 'Speed drill';
		return 'Bigram drill';
	}
</script>

<svelte:window onkeydown={onWindowKeydown} />

<div class="mx-auto max-w-3xl space-y-10">
	<header class="flex items-baseline justify-between gap-4">
		<!--
			Type subtitle sits directly under the h1 so the reader has context
			before the hero numbers hit ("Accuracy drill 64 WPM" reads
			differently than "Speed drill 64 WPM"). Nested in its own div so
			the flex row's space-between only splits the title group from the
			keyboard hint on the right.
		-->
		<div class="space-y-1">
			<h1 class="text-4xl font-semibold tracking-tight text-base-content">Session summary</h1>
			{#if state.status === 'ready'}
				<p
					class="text-xs font-medium tracking-[0.18em] text-base-content/50 uppercase"
					data-testid="session-type-label"
				>
					{sessionTypeLabel(state.session)}
				</p>
			{/if}
		</div>
		{#if state.status === 'ready'}
			<p class="text-xs font-medium tracking-[0.18em] text-base-content/50 uppercase">
				<kbd
					class="rounded-sm border border-base-300 bg-base-200 px-1.5 py-0.5 font-mono text-[0.65rem] tracking-normal text-base-content/70"
					>Enter</kbd
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
		{@const s = state.session}
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
					onclick={() => startPlannedSession(next)}
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
				<a href={resolve('/')} class="btn btn-lg btn-primary" data-testid="day-complete-cta"
					>Day complete · Back to dashboard</a
				>
				<button
					type="button"
					class="text-sm text-base-content/60 underline-offset-4 hover:text-base-content hover:underline"
					onclick={() => startFreshPlan()}
					data-testid="summary-start-another-round"
				>
					Start another round
				</button>
			{/if}
		</div>
	{/if}
</div>
