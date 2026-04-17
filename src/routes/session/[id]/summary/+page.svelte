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
	import { getSession } from '$lib/storage/service';
	import type { SessionSummary } from '$lib/session/types';
	import type { BigramAggregate } from '$lib/bigram/types';

	type LoadState =
		| { status: 'loading' }
		| { status: 'ready'; summary: SessionSummary }
		| { status: 'missing' }
		| { status: 'error'; message: string };

	let state = $state<LoadState>({ status: 'loading' });

	onMount(async () => {
		try {
			const summary = await getSession(page.params.id!);
			state = summary ? { status: 'ready', summary } : { status: 'missing' };
		} catch (err) {
			state = {
				status: 'error',
				message: err instanceof Error ? err.message : 'Unknown error'
			};
		}
	});

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

<div class="mx-auto max-w-3xl space-y-6">
	<header class="space-y-1">
		<h1 class="text-3xl font-bold">Session summary</h1>
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
		<section class="stats bg-base-200 shadow">
			<div class="stat">
				<div class="stat-title">Raw WPM</div>
				<div class="stat-value" data-testid="wpm-value">{s.wpm.toFixed(1)}</div>
				<div class="stat-desc">Not smoothed — first-pass reading</div>
			</div>
			<div class="stat">
				<div class="stat-title">Error rate</div>
				<div class="stat-value">{(s.errorRate * 100).toFixed(1)}%</div>
				<div class="stat-desc">First-input errors (spec §2.2)</div>
			</div>
			<div class="stat">
				<div class="stat-title">Duration</div>
				<div class="stat-value">{(s.durationMs / 1000).toFixed(1)}s</div>
			</div>
		</section>

		<section class="space-y-2">
			<h2 class="text-xl font-semibold">Slowest 5 transitions</h2>
			{#if slowest.length === 0}
				<p class="text-base-content/70">
					No clean bigram samples yet — need at least one error-free adjacent pair.
				</p>
			{:else}
				<table class="table">
					<thead>
						<tr>
							<th>Bigram</th>
							<th class="text-right">Mean (ms)</th>
							<th class="text-right">Occurrences</th>
							<th class="text-right">Error rate</th>
						</tr>
					</thead>
					<tbody data-testid="slowest-table-body">
						{#each slowest as b (b.bigram)}
							<tr>
								<td class="font-mono">{b.bigram === ' ' ? '␣' : b.bigram.replace(/ /g, '␣')}</td>
								<td class="text-right">{b.meanTime.toFixed(0)}</td>
								<td class="text-right">{b.occurrences}</td>
								<td class="text-right">{(b.errorRate * 100).toFixed(0)}%</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
		</section>

		<div class="flex gap-2">
			<a href="/session/diagnostic" class="btn btn-primary">Run another</a>
			<a href="/" class="btn btn-ghost">Dashboard</a>
		</div>
	{/if}
</div>
