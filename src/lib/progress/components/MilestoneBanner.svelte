<script lang="ts">
	/**
	 * WPM milestone banner (Phase 8.4).
	 *
	 * Prominent inline card at the top of the summary page when the user's
	 * 7-session rolling average has just crossed a round-number threshold.
	 * Not a modal / not full-screen — per the "one page, inline" constraint.
	 *
	 * Renders nothing when `event` is null, so the summary page can mount it
	 * unconditionally.
	 */
	import type { MilestoneEvent } from '../celebrations';

	interface Props {
		event: MilestoneEvent | null;
	}

	let { event }: Props = $props();
</script>

{#if event}
	<section
		class="flex items-center gap-5 rounded-lg border-2 border-primary/50 bg-primary/5 px-6 py-5"
		data-testid="milestone-banner"
		data-threshold={event.threshold}
		aria-labelledby="milestone-heading"
	>
		<span
			class="font-mono text-4xl leading-none font-medium text-primary tabular-nums"
			aria-hidden="true"
		>
			✓
		</span>
		<div class="space-y-1">
			<h2 id="milestone-heading" class="text-xl font-semibold tracking-tight text-base-content">
				Crossed {event.threshold} WPM
			</h2>
			<p class="text-sm text-base-content/70">
				Your 7-session average is now
				<span class="font-mono tabular-nums">{event.rollingWpm.toFixed(1)}</span> — above the
				<span class="font-mono tabular-nums">{event.threshold}</span> threshold.
			</p>
		</div>
	</section>
{/if}
