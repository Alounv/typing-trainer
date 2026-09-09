<script lang="ts">
	/**
	 * The one in-session control: which pairs get tinted, or none.
	 *
	 * Deliberately non-prescriptive — a pacer tells you what to do; this changes
	 * what you *notice* and leaves the regulating to you. `off` is a real third
	 * state and worth using regularly, so the skill gets checked without the
	 * training wheels.
	 *
	 * `onmousedown` is prevented so a click mid-passage never pulls focus off
	 * the typing input. Tab still reaches the buttons for keyboard users, where
	 * moving focus is the point.
	 */
	import type { DifficultyMode } from '../tint';

	interface Props {
		value: DifficultyMode | null;
		onChange: (next: DifficultyMode | null) => void;
	}

	let { value, onChange }: Props = $props();

	const OPTIONS: { mode: DifficultyMode | null; label: string; hint: string }[] = [
		{ mode: 'errors', label: 'Precision', hint: 'Tint the pairs you get wrong — slow down there' },
		{ mode: 'speed', label: 'Pace', hint: 'Tint the pairs that drag — notice the drag' },
		{ mode: null, label: 'Off', hint: 'No tint — check the skill without the training wheels' }
	];

	const active = $derived(OPTIONS.find((o) => o.mode === value) ?? OPTIONS[2]);
</script>

<div class="space-y-1.5" data-testid="tint-toggle" data-tint={value ?? 'off'}>
	<div class="flex items-center gap-3">
		<span class="text-[11px] font-medium tracking-[0.18em] text-base-content/40 uppercase">
			Nudge
		</span>
		<div class="join" role="group" aria-label="In-session tint">
			{#each OPTIONS as option (option.label)}
				<button
					type="button"
					class={`btn join-item btn-xs ${option.mode === value ? 'btn-active btn-primary' : 'btn-ghost'}`}
					aria-pressed={option.mode === value}
					data-testid={`tint-${option.mode ?? 'off'}`}
					onmousedown={(e) => e.preventDefault()}
					onclick={() => onChange(option.mode)}
				>
					{option.label}
				</button>
			{/each}
		</div>
	</div>
	<p class="text-xs text-base-content/50">{active.hint}</p>
</div>
