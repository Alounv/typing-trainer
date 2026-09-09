<script lang="ts">
	/**
	 * The end-of-session pacing verdict, as one statement.
	 *
	 * Lives on the summary page rather than the typing view for the same reason
	 * `SessionShell` keeps its readouts off the text: a live pace readout pulls
	 * the eye off what it should be reading. The judgement lands once, here.
	 */
	import type { PacingAssessment } from '$lib/skill';
	import { RECENT_WINDOW } from '$lib/support/core';
	import { PACING_COPY, PACING_TONE_CLASSES, pacingDetail } from '../pacingDisplay';

	interface Props {
		assessment: PacingAssessment;
	}

	let { assessment }: Props = $props();

	const copy = $derived(PACING_COPY[assessment.verdict]);
	const detail = $derived(pacingDetail(assessment));
</script>

<section
	class={`flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-lg border px-6 py-4 ${PACING_TONE_CLASSES[copy.tone]}`}
	data-testid="pacing-verdict"
	data-verdict={assessment.verdict}
	aria-labelledby="pacing-heading"
>
	<h2 id="pacing-heading" class="text-lg font-semibold tracking-tight">
		{copy.headline}
	</h2>
	<p class="min-w-0 flex-1 text-sm text-base-content/70">
		{detail}
	</p>
	{#if assessment.recentWpm !== undefined}
		<!-- Same window as the milestone banner, but excluding this session:
		     a baseline this session is measured against cannot contain it. The
		     two numbers are close, never equal, so both stay labelled. -->
		<p class="font-mono text-xs whitespace-nowrap text-base-content/50 tabular-nums">
			{assessment.wpm.toFixed(1)} vs {assessment.recentWpm.toFixed(1)} over previous {RECENT_WINDOW}
		</p>
	{/if}
</section>
