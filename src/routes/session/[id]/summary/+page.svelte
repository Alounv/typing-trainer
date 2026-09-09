<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { loadable } from '$lib/support/loadable.svelte';
	import type { SessionSummary } from '$lib/support/core';
	import Summary from '$lib/progress/components/Summary.svelte';
	import { loadSummaryContext } from './loader';

	const summary = loadable(
		() => loadSummaryContext(page.params.id!),
		'Failed to load this session.'
	);

	/**
	 * Only `real-text` is produced now; the rest are historical rows whose
	 * session types no longer exist. They still have to render — a summary the
	 * user can open must say what it was.
	 */
	function sessionTypeLabel(s: SessionSummary): string {
		if (s.type === 'real-text') return 'Real text';
		if (s.type === 'diagnostic') return 'Diagnostic';
		return 'Bigram drill';
	}
</script>

<div class="mx-auto max-w-3xl space-y-10">
	<header class="flex items-baseline justify-between gap-4">
		<div class="space-y-1">
			<h1 class="text-4xl font-semibold tracking-tight text-base-content">Session summary</h1>
			{#if summary.current.status === 'ready' && summary.current.data}
				<p
					class="text-xs font-medium tracking-[0.18em] text-base-content/50 uppercase"
					data-testid="session-type-label"
				>
					{sessionTypeLabel(summary.current.data.session)}
				</p>
			{/if}
		</div>
	</header>

	{#if summary.current.status === 'loading'}
		<p class="text-base-content/70">Loading…</p>
	{:else if summary.current.status === 'error'}
		<p class="text-error" role="alert">Couldn't load session: {summary.current.message}</p>
	{:else if summary.current.data === null}
		<p class="text-base-content/70" role="alert">
			No session found for this id. It may have been cleared.
		</p>
	{:else}
		<Summary {...summary.current.data} />

		<div class="flex flex-wrap items-center gap-6 pt-2">
			<a href={resolve('/')} class="btn btn-lg btn-primary" data-testid="back-to-practice">
				Back to practice →
			</a>
		</div>
	{/if}
</div>
