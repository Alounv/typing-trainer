<script lang="ts">
	import { scale } from 'svelte/transition';
	import type { LedgerEntry } from '../bigramLedger';

	interface Props {
		bigram: string;
		isExposure: boolean;
		entry?: LedgerEntry;
	}

	let { bigram, isExposure, entry }: Props = $props();

	const debt = $derived(entry?.debt ?? 0);
	const chipState = $derived.by(() => {
		if (!entry) return 'neutral';
		if (entry.debt > 0) return 'damaged';
		if (entry.wasDamaged) return 'recovered';
		return 'neutral';
	});
	// Ambient fill for chips that have never been damaged: how much of this
	// bigram's presence in the text has been typed cleanly.
	const cleanPct = $derived(
		entry && entry.total > 0 ? Math.min(100, (entry.cleanHits / entry.total) * 100) : 0
	);

	// Flash on the keystroke that adds debt; the pips stay, the flash doesn't.
	let previousDebt = 0;
	let hit = $state(false);
	let hitTimer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => {
		if (debt > previousDebt) {
			hit = true;
			clearTimeout(hitTimer);
			hitTimer = setTimeout(() => (hit = false), 450);
		}
		previousDebt = debt;
	});
	$effect(() => () => clearTimeout(hitTimer));

	const toneClass = $derived.by(() => {
		if (chipState === 'damaged') return 'bg-error/15 text-error ring-1 ring-error/40';
		if (chipState === 'recovered') return 'bg-success/15 text-success ring-1 ring-success/40';
		if (isExposure) return 'border border-dashed border-base-content/40 text-base-content/60';
		return 'bg-base-200 text-base-content/80';
	});

	const label = $derived.by(() => {
		const kind = isExposure ? 'new bigram for exposure practice' : 'diagnosed weakness';
		if (chipState === 'damaged') return `${bigram}, ${kind}, ${debt} clean repeats owed`;
		if (chipState === 'recovered') return `${bigram}, ${kind}, cleared`;
		return `${bigram}, ${kind}`;
	});
</script>

<li
	class="chip relative overflow-hidden rounded-sm px-2 py-0.5 font-mono text-xs {toneClass}"
	class:hit
	aria-label={label}
	data-testid="drill-chip"
	data-bigram={bigram}
	data-state={chipState}
	data-debt={debt}
>
	{#if chipState === 'neutral' && cleanPct > 0}
		<span
			class="absolute inset-x-0 bottom-0 h-px origin-left bg-success/70 transition-transform duration-200 ease-out motion-reduce:transition-none"
			style="transform: scaleX({cleanPct / 100})"
			aria-hidden="true"
		></span>
	{/if}
	<span class="relative inline-flex items-center gap-1.5">
		<span
			>{#each bigram as char, i (i)}{#if char === ' '}<span
						class="text-base-content/35"
						aria-label="space">␣</span
					>{:else}{char}{/if}{/each}</span
		>
		{#if debt > 0}
			<span class="inline-flex items-center gap-0.5" aria-hidden="true">
				{#each Array.from({ length: debt }, (_, i) => i) as pip (pip)}
					<span
						class="pip inline-block h-1 w-1 rounded-full bg-error"
						in:scale={{ duration: 120 }}
						out:scale={{ duration: 200 }}
					></span>
				{/each}
			</span>
		{/if}
	</span>
</li>

<style>
	@media (prefers-reduced-motion: no-preference) {
		.chip.hit {
			animation: chip-hit 450ms ease-out;
		}
	}

	@keyframes chip-hit {
		0% {
			transform: translateX(0) scale(1);
			box-shadow: 0 0 0 0 var(--color-error);
		}
		15% {
			transform: translateX(-3px) scale(1.12);
			box-shadow: 0 0 0 4px color-mix(in oklab, var(--color-error) 45%, transparent);
		}
		35% {
			transform: translateX(3px) scale(1.08);
		}
		55% {
			transform: translateX(-2px) scale(1.04);
		}
		100% {
			transform: translateX(0) scale(1);
			box-shadow: 0 0 0 8px transparent;
		}
	}
</style>
