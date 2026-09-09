<script lang="ts">
	/**
	 * Dashboard. One action and a look back at recent sessions.
	 *
	 * It used to be a plan: a scheduler decided what kind of session came next
	 * and rendered it as a stack of cards. That question no longer exists —
	 * there is one session type, and which passage it serves is chosen from
	 * outstanding debt when the session loads. So the page answers "how has it
	 * been going" instead of "what now", and trends still live on `/analytics`.
	 */
	import { resolve } from '$app/paths';
	import { VERSION } from '$lib/version';
	import { loadable } from '$lib/support/loadable.svelte';
	import PacingBadge from '$lib/progress/components/PacingBadge.svelte';
	import { loadDashboard } from './loader';

	const dashboard = loadable(loadDashboard, 'Failed to load dashboard.');

	const dateFormat = new Intl.DateTimeFormat(undefined, {
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit'
	});
</script>

<div class="mx-auto max-w-3xl space-y-12">
	<header class="space-y-3">
		<p class="text-xs font-medium tracking-[0.18em] text-base-content/50 uppercase">
			Typing Trainer · {VERSION}
		</p>
		<h1 class="text-4xl font-semibold tracking-tight text-base-content">Practice</h1>
		<p class="max-w-xl text-base-content/65">
			Real prose, chosen for the transitions you currently owe repeats on.
		</p>
	</header>

	<section>
		<a
			href={resolve('/session/real-text')}
			class="btn btn-lg btn-primary"
			data-testid="start-session"
		>
			Start a passage →
		</a>
	</section>

	{#if dashboard.current.status === 'loading'}
		<p class="text-base-content/60">Loading…</p>
	{:else if dashboard.current.status === 'error'}
		<p class="text-error" role="alert">{dashboard.current.message}</p>
	{:else if dashboard.current.data.recent.length === 0}
		<section class="border-t border-base-300 pt-6" data-testid="no-history">
			<p class="text-sm text-base-content/55">
				No sessions yet. The first few passages are chosen at random — there is nothing owed to
				score them against until you have typed some.
			</p>
		</section>
	{:else}
		<section class="space-y-4 border-t border-base-300 pt-6">
			<h2 class="text-xs font-medium tracking-[0.18em] text-base-content/50 uppercase">
				Recent sessions
			</h2>
			<ul class="divide-y divide-base-300" data-testid="recent-sessions">
				{#each dashboard.current.data.recent as session (session.id)}
					<li class="flex flex-wrap items-baseline gap-x-6 gap-y-1 py-3 text-sm">
						<span class="w-32 shrink-0 text-base-content/50">
							{dateFormat.format(new Date(session.timestamp))}
						</span>
						<span class="font-mono text-base-content/90 tabular-nums">
							{session.wpm.toFixed(1)}<span class="text-base-content/40"> wpm</span>
						</span>
						<span class="font-mono text-base-content/90 tabular-nums">
							{(session.errorRate * 100).toFixed(1)}<span class="text-base-content/40">% err</span>
						</span>
						<PacingBadge verdict={session.verdict} />
						<a
							href={resolve('/session/[id]/summary', { id: session.id })}
							class="ml-auto text-base-content/60 underline-offset-4 hover:text-base-content hover:underline"
						>
							Details →
						</a>
					</li>
				{/each}
			</ul>
		</section>
	{/if}
</div>
