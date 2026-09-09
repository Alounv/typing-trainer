<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { loadable } from '$lib/support/loadable.svelte';
	import Summary from '$lib/progress/components/Summary.svelte';
	import { loadSummaryContext } from './loader';

	const summary = loadable(
		() => loadSummaryContext(page.params.id!),
		'Failed to load this session.'
	);

	/**
	 * Enter starts the next passage, so a finished session flows straight into
	 * the next without reaching for the mouse. Form fields and modifier combos
	 * are skipped so we don't hijack native inputs or OS shortcuts.
	 */
	function onWindowKeydown(event: KeyboardEvent) {
		if (summary.current.status !== 'ready' || !summary.current.data) return;
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
</script>

<svelte:window onkeydown={onWindowKeydown} />

<div class="mx-auto max-w-3xl space-y-10">
	<header class="flex items-baseline justify-between gap-4">
		<h1 class="text-4xl font-semibold tracking-tight text-base-content">Session summary</h1>
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
				data-testid="back-to-practice"
			>
				Back to practice
			</a>
		</div>
	{/if}
</div>
