<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { loadSummaryContext, type SummaryViewModel } from './loader';
	import { startPlannedSession, startFreshPlan } from '$lib/plan';
	import type { SessionSummary } from '$lib/support/core';
	import Summary from '$lib/progress/components/Summary.svelte';

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
	 * Enter triggers the primary CTA (next session or dashboard). We skip form fields and modifier
	 * combos so we don't hijack native inputs or OS shortcuts.
	 */
	function onWindowKeydown(event: KeyboardEvent) {
		if (state.status !== 'ready') return;
		if (event.key !== 'Enter' && event.code !== 'Enter') return;
		if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;

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

	/** Legacy drill sessions (no `drillMode`) fall back to generic "Bigram drill" so old records render. */
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
		<Summary
			session={state.session}
			recentSessions={state.recentSessions}
			statsSessions={state.statsSessions}
			corpusFrequencies={state.corpusFrequencies}
		/>

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
