<script lang="ts">
	import type { MovementEvent } from '../celebrations';

	interface Props {
		events: readonly MovementEvent[];
	}

	let { events }: Props = $props();

	function classLabel(c: MovementEvent['from'] | MovementEvent['to']): string {
		return c ?? 'new';
	}

	function glyphFor(bigram: string): string {
		return bigram === ' ' ? '␣' : bigram.replace(/ /g, '␣');
	}
</script>

{#if events.length > 0}
	<section
		class="space-y-4"
		data-testid="bigram-movements"
		aria-labelledby="bigram-movements-heading"
	>
		<div class="flex items-baseline justify-between">
			<h2 id="bigram-movements-heading" class="text-xl font-semibold tracking-tight">
				Bigram movements
			</h2>
			<p class="text-xs font-medium tracking-[0.18em] text-base-content/50 uppercase">
				This session
			</p>
		</div>
		<ul class="divide-y divide-base-300 border-y border-base-300">
			{#each events as e (e.bigram + e.from + e.to)}
				<li
					class="grid grid-cols-[auto_auto_1fr] items-baseline gap-6 py-3"
					data-testid="movement-event"
					data-direction={e.direction}
				>
					<span
						class="font-mono text-xl tracking-wide text-base-content"
						aria-label={`bigram ${e.bigram}`}
					>
						{glyphFor(e.bigram)}
					</span>
					<span
						class={`text-xs font-medium tracking-[0.18em] uppercase ${
							e.direction === 'up' ? 'text-success' : 'text-warning'
						}`}
					>
						{e.direction === 'up' ? '↑ Improved' : '↓ Regressed'}
					</span>
					<span class="font-mono text-sm tracking-wide text-base-content/70">
						{classLabel(e.from)} → {classLabel(e.to)}
					</span>
				</li>
			{/each}
		</ul>
	</section>
{/if}
