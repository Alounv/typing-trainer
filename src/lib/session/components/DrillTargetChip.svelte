<script lang="ts">
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

	// How much of this bigram's presence in the drill has been typed cleanly.
	// Only for chips that owe nothing — how *much* is owed is the meter's job.
	const cleanPct = $derived.by(() => {
		if (!entry || entry.debt > 0 || entry.wasDamaged || entry.total === 0) return 0;
		return Math.min(100, (entry.cleanHits / entry.total) * 100);
	});

	// Flash on the keystroke that puts this bigram back in debt.
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
		if (chipState === 'damaged') return `${bigram}, ${kind}, owes clean repeats`;
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
>
	{#if cleanPct > 0}
		<span
			class="absolute inset-x-0 bottom-0 h-px origin-left bg-success/70 transition-transform duration-200 ease-out motion-reduce:transition-none"
			style="transform: scaleX({cleanPct / 100})"
			aria-hidden="true"
		></span>
	{/if}
	<span class="relative"
		>{#each bigram as char, i (i)}{#if char === ' '}<span
					class="text-base-content/35"
					aria-label="space">␣</span
				>{:else}{char}{/if}{/each}</span
	>
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
