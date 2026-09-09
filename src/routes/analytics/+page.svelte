<script lang="ts">
	import Analytics from '$lib/progress/components/Analytics.svelte';
	import { loadable } from '$lib/support/async';
	import { VERSION } from '$lib/version';
	import { loadAnalyticsInputs } from './loader';

	const analytics = loadable(loadAnalyticsInputs, 'Failed to load analytics.');
</script>

<div class="mx-auto max-w-4xl space-y-10">
	<header class="space-y-3">
		<p class="text-xs font-medium tracking-[0.18em] text-base-content/50 uppercase">
			Progress · {VERSION}
		</p>
		<h1 class="text-4xl font-semibold tracking-tight text-base-content">Analytics</h1>
		<p class="text-base-content/65">WPM trend, error rate, and where each bigram stands.</p>
	</header>

	{#if analytics.current.status === 'loading'}
		<p class="text-base-content/60">Loading…</p>
	{:else if analytics.current.status === 'error'}
		<p class="text-error" role="alert">{analytics.current.message}</p>
	{:else}
		<Analytics {...analytics.current.data} />
	{/if}
</div>
