<script lang="ts">
	/**
	 * The pacing verdict as a compact chip, for lists of sessions.
	 *
	 * A component rather than exported class strings so the tone palette stays
	 * inside `progress/` — routes get the rendered badge, not the vocabulary.
	 */
	import type { PacingVerdict } from '$lib/skill';
	import { PACING_COPY, PACING_TONE_CLASSES } from '../pacingDisplay';

	interface Props {
		verdict: PacingVerdict;
	}

	let { verdict }: Props = $props();

	const copy = $derived(PACING_COPY[verdict]);
</script>

<span
	class={`rounded-sm border px-2 py-0.5 text-xs whitespace-nowrap ${PACING_TONE_CLASSES[copy.tone]}`}
	data-testid="pacing-badge"
	data-verdict={verdict}
>
	{copy.headline}
</span>
