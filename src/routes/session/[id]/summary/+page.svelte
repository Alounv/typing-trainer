<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { loadSummaryContext, type SummaryViewModel } from './loader';
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
	 * Enter starts the next passage. We skip form fields and modifier combos so
	 * we don't hijack native inputs or OS shortcuts.
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
		window.location.href = resolve('/session/real-text');
	}

	/**
	 * Only `real-text` is produced now; the rest are historical rows whose
	 * session types no longer exist. They still have to render — a summary the
	 * user can open must say what it was.
	 */
	function sessionTypeLabel(s: SessionSummary): string {
		if (s.type === 'real-text') return 'Real text';
		if (s.type === 'diagnostic') return 'Diagnostic';
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
				next passage
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
			statsSessions={state.statsSessions}
			corpusFrequencies={state.corpusFrequencies}
			thresholds={state.thresholds}
		/>

		<div class="flex flex-wrap items-center gap-6 pt-2">
			<a
				href={resolve('/session/real-text')}
				class="btn btn-lg btn-primary"
				data-testid="next-session"
			>
				Next passage →
			</a>
			<a
				href={resolve('/')}
				class="text-sm text-base-content/60 underline-offset-4 hover:text-base-content hover:underline"
			>
				Back to practice
			</a>
		</div>
	{/if}
</div>
