<script lang="ts">
	/**
	 * One-stop shell for any session type. Composes:
	 *   - a title + lede (per session type)
	 *   - a thin progress bar above the drill
	 *   - the typing surface with live error / corrected-state tracking
	 *
	 * Live elapsed / error readouts are deliberately omitted — those are
	 * shown on the post-session summary so the eye stays on the text
	 * during typing. The progress bar, and on accuracy drills the target
	 * chips + clean-credit meter, are the only ambient signals.
	 *
	 * Wiring: we build a {@link SessionRunner} from the supplied config and
	 * feed every keystroke event into it. Once the text is fully typed we
	 * finalize, persist, and redirect. Keeps all three session routes
	 * (diagnostic, bigram-drill, real-text) from duplicating the same ~100 lines.
	 */
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { SvelteSet } from 'svelte/reactivity';
	import TypingSurface from './TypingSurface.svelte';
	import TintToggle from './TintToggle.svelte';
	import type { KeystrokeEvent } from '$lib/support/core';
	import type { SessionType, StoredSession } from '$lib/support/core';
	import { SessionRunner } from '../runner';
	import type { DifficultyMode } from '../bigramDifficulty';
	import { resolveInitialTint } from '../initialTint';
	import { saveSession } from '../persistence';

	interface Props {
		/** Session kind — drives the persisted summary's `type` field. */
		type: SessionType;
		text: string;
		title: string;
		/** One-sentence explanation of what this session actually does. */
		what?: string;
		/** One-sentence guidance on how the user should type through it. */
		approach?: string;
	}

	let { type, text, title, what, approach }: Props = $props();

	// Word count for the eyebrow micro-label, so the passage's size is legible
	// before the first keystroke.
	const wordCount = $derived(text.trim().split(/\s+/).filter(Boolean).length);

	// Reactive mirrors of runner state. The runner itself is plain TS with
	// no reactivity; we shadow the bits the UI reads in $state so the
	// rendered readouts update correctly.
	let position = $state(0);
	// Every wrong position — drives red coloring in TextDisplay.
	const errorPositions = new SvelteSet<number>();
	// Subset: first wrong position in each burst. Drives corrected-marking
	// eligibility — fumble follow-ups are noise and don't
	// count. Mirrors the burst-follow-up rule in postprocess.ts / extraction.ts.
	const countedErrorPositions = new SvelteSet<number>();
	const correctedPositions = new SvelteSet<number>();
	let running = $state(false);
	let saving = $state(false);
	let saveError = $state<string | null>(null);

	// `performance.now()` anchor captured on the first keystroke, not on
	// mount — reading / focus time shouldn't inflate the WPM denominator.
	let sessionStart: number | null = null;

	// These props are effectively frozen for a session's lifetime — the
	// route remounts this component (via `{#if state.ready}`) whenever a
	// new session starts. Svelte's reactivity warning about capturing
	// initial values is noise in this context; the runner instance is
	// deliberately tied to the first-mount snapshot.
	// svelte-ignore state_referenced_locally
	const runner = new SessionRunner({
		type,
		text
	});

	const progressPct = $derived(Math.round((position / text.length) * 100));

	// The tint is the user's, not the route's. It opens on whatever the last
	// session's verdict calls for and can be flipped at any point, including
	// off. `tintChosen` stops the async default from landing on top of a choice
	// the user already made while it was in flight.
	let difficultyMode = $state<DifficultyMode | null>(null);
	let tintChosen = false;

	onMount(async () => {
		const suggested = await resolveInitialTint();
		if (!tintChosen) difficultyMode = suggested;
	});

	function chooseTint(next: DifficultyMode | null) {
		tintChosen = true;
		difficultyMode = next;
	}

	function onEvent(event: KeystrokeEvent) {
		if (sessionStart === null) {
			sessionStart = performance.now();
			running = true;
		}
		runner.recordEvent(event);
		position = runner.position;
		// Error / correction state for the drill rendering. We don't read
		// these off the runner (it only cares about first-input accuracy);
		// these sets drive the character-state classes on TextDisplay.
		// Burst rule: only the first wrong position in a run counts toward the
		// error tally and is eligible for the corrected mark — a fumble of
		// several wrongs in a row registers as one mistake, not many.
		if (event.actual !== event.expected) {
			if (!errorPositions.has(event.position) && !errorPositions.has(event.position - 1)) {
				countedErrorPositions.add(event.position);
			}
			errorPositions.add(event.position);
		} else if (errorPositions.has(event.position)) {
			if (countedErrorPositions.has(event.position)) {
				// First-of-burst position that's now correctly retyped → dotted.
				correctedPositions.add(event.position);
			} else {
				// Burst follow-up corrected: scrub the red so it renders plain.
				// (Was never counted as a real error, doesn't get a corrected mark.)
				errorPositions.delete(event.position);
			}
		}

		// Finalize on the last char rather than on any later signal.
		if (runner.isComplete()) finalizeAndNavigate();
	}

	async function finalizeAndNavigate() {
		if (saving || !running) return;
		running = false;
		saving = true;
		try {
			const elapsed = performance.now() - (sessionStart ?? performance.now());
			const session: StoredSession = runner.finalize(elapsed);
			await saveSession(session);
			await goto(resolve('/session/[id]/summary', { id: session.id }));
		} catch (err) {
			saving = false;
			saveError = err instanceof Error ? err.message : 'Failed to save session.';
		}
	}
</script>

<div class="mx-auto max-w-3xl space-y-8">
	<!--
		Header + briefing block. `WHAT / HOW / DRILLING` labels live in one
		aligned column so the page reads like a single instrument panel
		rather than three disconnected paragraphs. Uses the same
		letter-spaced uppercase micro-label vocabulary as the dashboard and
		settings page.
	-->
	<header class="space-y-6">
		<div class="space-y-3">
			<p
				class="text-xs font-medium tracking-[0.18em] text-base-content/50 uppercase"
				data-testid="session-eyebrow"
			>
				Real text · {wordCount} words
			</p>
			<h1 class="text-4xl font-semibold tracking-tight">{title}</h1>
		</div>
		{#if what || approach}
			<dl class="max-w-xl space-y-3 text-sm">
				{#if what}
					<div class="grid grid-cols-[5rem_1fr] gap-x-4">
						<dt
							class="pt-0.5 text-[11px] font-medium tracking-[0.18em] text-base-content/40 uppercase"
						>
							What
						</dt>
						<dd class="text-base-content/70">{what}</dd>
					</div>
				{/if}
				{#if approach}
					<div class="grid grid-cols-[5rem_1fr] gap-x-4">
						<dt
							class="pt-0.5 text-[11px] font-medium tracking-[0.18em] text-base-content/40 uppercase"
						>
							How
						</dt>
						<dd class="text-base-content/70">{approach}</dd>
					</div>
				{/if}
			</dl>
		{/if}

		<TintToggle value={difficultyMode} onChange={chooseTint} />
	</header>

	<!--
		Ambient progress: hairline bar above the passage. Doubles as a visible
		signal that the session has started (filled) vs. is waiting on the
		first keystroke (flat).
	-->
	<div class="space-y-3">
		<div
			class="h-0.5 w-full overflow-hidden rounded-full bg-base-300"
			role="progressbar"
			aria-label="Session progress"
			aria-valuemin="0"
			aria-valuemax="100"
			aria-valuenow={progressPct}
		>
			<div
				class="h-full bg-primary transition-[width] duration-75 ease-out motion-reduce:transition-none"
				style="width: {(position / text.length) * 100}%"
			></div>
		</div>

		<TypingSurface
			{text}
			bind:position
			{errorPositions}
			{correctedPositions}
			{difficultyMode}
			{onEvent}
		/>
	</div>

	<!--
		No live elapsed / error readouts: those are reserved for the
		post-session summary so they don't pull the eye off the text
		while typing. Save state still surfaces so a failed persistence
		doesn't disappear silently.
	-->
	{#if saving || saveError}
		<div class="flex flex-wrap items-baseline gap-x-6 text-sm">
			{#if saving}
				<span class="text-base-content/55">Saving…</span>
			{/if}
			{#if saveError}
				<span class="text-error" role="alert">{saveError}</span>
			{/if}
		</div>
	{/if}
</div>
