<script lang="ts">
	/**
	 * Pre-onboarding landing. Until the scheduler (Phase 6) and progress
	 * store (Phase 10) are wired up, this page can't recommend a session
	 * intelligently. So instead of faking it with a dashboard stat-grid
	 * (the canonical AI-slop template), we show a single deliberate CTA
	 * plus context on what's coming.
	 */
	import { getRecentSessions } from '$lib/storage/service';
	import { onMount } from 'svelte';
	import type { SessionSummary } from '$lib/session/types';

	let lastSession = $state<SessionSummary | null>(null);

	onMount(async () => {
		const [latest] = await getRecentSessions(1);
		if (latest) lastSession = latest;
	});
</script>

<div class="mx-auto max-w-3xl space-y-12">
	<!--
		Hero block: small eyebrow + bold title + a single-sentence lede.
		No stat cards, no metrics, no placeholder chart. One action only.
	-->
	<header class="space-y-4">
		<p class="text-xs font-medium tracking-[0.18em] text-base-content/50 uppercase">
			Typing Trainer · v0.1
		</p>
		<h1 class="text-5xl font-semibold tracking-tight text-base-content">
			Practice the pairs that slow you down.
		</h1>
		<p class="max-w-xl text-base text-base-content/70">
			A diagnostic records every keystroke, classifies each character pair
			by speed and error rate, then prescribes drills for the pairs that
			actually hold your typing back.
		</p>
	</header>

	<section class="space-y-4">
		<a
			href="/session/diagnostic"
			class="btn btn-primary btn-lg tracking-wide"
			data-testid="start-diagnostic"
		>
			Start diagnostic
		</a>
		<p class="text-sm text-base-content/55">
			~1 minute. No account, no upload — data stays in this browser.
		</p>
	</section>

	{#if lastSession}
		<!--
			A single quiet line about the most recent run — enough to give
			returning users a handhold without pretending to be a progress
			dashboard. Real trend/sparkline work lands with Phase 10.
		-->
		<section
			class="flex flex-wrap items-baseline gap-x-6 gap-y-2 border-t border-base-300 pt-6 text-sm"
		>
			<p class="text-base-content/55">Last session</p>
			<p class="font-mono tabular-nums text-base-content/90">
				{lastSession.wpm.toFixed(1)}<span class="text-base-content/40"> WPM</span>
			</p>
			<p class="font-mono tabular-nums text-base-content/90">
				{(lastSession.errorRate * 100).toFixed(1)}<span class="text-base-content/40"> % err</span>
			</p>
			<a
				href="/session/{lastSession.id}/summary"
				class="ml-auto text-base-content/60 underline-offset-4 hover:text-base-content hover:underline"
			>
				See details →
			</a>
		</section>
	{/if}
</div>
