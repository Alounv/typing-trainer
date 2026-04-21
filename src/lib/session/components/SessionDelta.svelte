<script lang="ts">
	/**
	 * Post-session bigram activity (Phase 8.1, trimmed).
	 *
	 * Originally a three-stat "how this compares" card with WPM / errors /
	 * bigrams. The WPM and error cards duplicated the hero metric and error
	 * chip above, so they were removed — only bigram activity stays, because
	 * "did any bigrams graduate or regress?" isn't shown anywhere else on the
	 * summary page.
	 */
	import type { SessionDelta } from '$lib/progress';

	interface Props {
		delta: SessionDelta;
	}

	let { delta }: Props = $props();
</script>

<section class="space-y-3" aria-labelledby="delta-heading" data-testid="session-delta">
	<div class="flex items-baseline justify-between">
		<h2 id="delta-heading" class="text-xl font-semibold tracking-tight">Bigrams</h2>
		<p class="text-xs tracking-wide text-base-content/50 uppercase">This session</p>
	</div>
	<div class="flex items-baseline gap-4" data-testid="delta-bigrams">
		<span class="font-mono text-3xl font-medium text-base-content tabular-nums">
			{delta.bigrams.drilled}
		</span>
		<span class="text-sm text-base-content/60">drilled</span>
		<span class="font-mono text-xs text-base-content/45 tabular-nums">
			{#if delta.bigrams.graduatedToHealthy > 0}
				· {delta.bigrams.graduatedToHealthy} graduated{#if delta.bigrams.regressed > 0}, {delta
						.bigrams.regressed} regressed{/if}
			{:else if delta.bigrams.regressed > 0}
				· {delta.bigrams.regressed} regressed
			{:else}
				· no class changes
			{/if}
		</span>
	</div>
</section>
