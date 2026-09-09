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
	{#if assessment.recentCleanWpm !== undefined}
		<!--
			Both figures have correction time removed, because that is what the
			verdict compares — raw WPM here would show a gap the verdict did not
			act on. They read higher than the headline WPM above for the same
			reason, so the label has to say so.

			Same window as the milestone banner, but excluding this session: a
			baseline this session is measured against cannot contain it.
		-->
		<p
			class="text-right font-mono text-xs whitespace-nowrap text-base-content/50 tabular-nums"
			title="Words per minute with the estimated correction time removed, so the comparison is finger speed rather than time spent fixing mistakes."
		>
			{assessment.cleanWpm.toFixed(1)} vs {assessment.recentCleanWpm.toFixed(1)}
			<br />
			<span class="tracking-tight">between corrections, previous {RECENT_WINDOW}</span>
		</p>
	{/if}
</section>
