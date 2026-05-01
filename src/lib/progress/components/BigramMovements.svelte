<script lang="ts">
	import { groupMovements, type MovementEvent } from '../celebrations';
	import BigramMovementTrack from './BigramMovementTrack.svelte';

	interface Props {
		events: readonly MovementEvent[];
	}

	let { events }: Props = $props();

	const groups = $derived(groupMovements(events));

	function classLabel(c: MovementEvent['from'] | MovementEvent['to']): string {
		return c ?? 'new';
	}

	function glyphFor(bigram: string): string {
		return bigram === ' ' ? '␣' : bigram.replace(/ /g, '␣');
	}
</script>

{#if groups.length > 0}
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
			{#each groups as g (`${g.from}→${g.to}`)}
				<li
					class="flex flex-wrap items-center gap-x-6 gap-y-2 py-3"
					data-testid="movement-group"
					data-direction={g.direction}
					data-from={g.from ?? 'new'}
					data-to={g.to}
				>
					<BigramMovementTrack from={g.from} to={g.to} direction={g.direction} />
					<span class="sr-only">
						{g.direction === 'up' ? 'Improved' : 'Regressed'}: {classLabel(g.from)} to {classLabel(
							g.to
						)}
					</span>
					<ul class="flex flex-wrap gap-1.5">
						{#each g.bigrams as bigram (bigram)}
							<li
								class="rounded bg-base-200 px-2 py-0.5 font-mono text-sm tracking-wide text-base-content"
								data-testid="movement-bigram"
								aria-label={`bigram ${bigram}`}
							>
								{glyphFor(bigram)}
							</li>
						{/each}
					</ul>
				</li>
			{/each}
		</ul>
	</section>
{/if}
