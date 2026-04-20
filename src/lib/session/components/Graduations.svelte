<script lang="ts">
	/**
	 * Inline graduation callouts (Phase 8.3).
	 *
	 * List-style: the bigram itself leads each row as the subject, followed
	 * by a tier micro-label and a short phrase. Deliberately no checkmark
	 * ornament — the design language favours letter-spaced uppercase tags
	 * over decorative glyphs. Mount unconditionally; renders nothing when
	 * empty.
	 */
	import type { GraduationEvent } from '../../progress';

	interface Props {
		events: readonly GraduationEvent[];
	}

	let { events }: Props = $props();

	/** Short uppercase tier tag. Typographic marker, not a glyph. */
	function tierTag(tier: GraduationEvent['tier']): string {
		switch (tier) {
			case 'healthy':
				return 'Healthy';
			case 'escaped-acquisition':
				return 'Escaped';
			case 'cleaned-up':
				return 'Cleaned';
		}
	}

	/** Trailing phrase — the "so what" clause after the tier tag. */
	function phrase(tier: GraduationEvent['tier']): string {
		switch (tier) {
			case 'healthy':
				return 'graduated to healthy';
			case 'escaped-acquisition':
				return 'no longer an acquisition gap';
			case 'cleaned-up':
				return 'hasty → fluency';
		}
	}

	/** Render space as a visible marker, matching the slowest-transitions list. */
	function glyphFor(bigram: string): string {
		return bigram === ' ' ? '␣' : bigram.replace(/ /g, '␣');
	}
</script>

{#if events.length > 0}
	<section class="space-y-4" data-testid="graduations" aria-labelledby="graduations-heading">
		<div class="flex items-baseline justify-between">
			<h2 id="graduations-heading" class="text-xl font-semibold tracking-tight">Graduations</h2>
			<p class="text-xs font-medium tracking-[0.18em] text-base-content/50 uppercase">
				This session
			</p>
		</div>
		<ul class="divide-y divide-base-300 border-y border-base-300">
			{#each events as e (e.bigram + e.tier)}
				<li
					class="grid grid-cols-[auto_auto_1fr] items-baseline gap-6 py-3"
					data-testid="graduation-event"
					data-tier={e.tier}
				>
					<span
						class="font-mono text-xl tracking-wide text-base-content"
						aria-label={`bigram ${e.bigram}`}
					>
						{glyphFor(e.bigram)}
					</span>
					<span class="text-xs font-medium tracking-[0.18em] text-base-content/50 uppercase">
						{tierTag(e.tier)}
					</span>
					<span class="text-sm text-base-content/70">{phrase(e.tier)}</span>
				</li>
			{/each}
		</ul>
	</section>
{/if}
