<script lang="ts">
	/**
	 * Diagnostic session route. Shell-driven: a fixed passage, no target
	 * bigrams, raw events persisted so thresholds can be replayed later
	 * (spec §2.8).
	 */
	import SessionShell from '$lib/session/components/SessionShell.svelte';

	// Hardcoded for v0.1 walking-skeleton semantics. A real diagnostic
	// (Phase 6 scheduler) will sample from the corpus sized to target WPM.
	const TEXT =
		'The quick brown fox jumps over the lazy dog. Typing trainers improve speed and accuracy through deliberate practice.';
</script>

<SessionShell
	type="diagnostic"
	text={TEXT}
	title="Diagnostic"
	lede="Type the passage below. Errors are recorded but not blocked — just keep going."
	persistRawEvents
/>
