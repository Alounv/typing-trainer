<script lang="ts">
	import type { SessionDelta } from '../delta';

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
	</div>
</section>
