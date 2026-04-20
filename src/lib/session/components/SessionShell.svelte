<script lang="ts">
	/**
	 * One-stop shell for any session type. Composes:
	 *   - a title + lede (per session type)
	 *   - a thin progress bar above the drill
	 *   - the typing surface with live error / corrected-state tracking
	 *   - a Timer + error-count row (WPM is reserved for the summary)
	 *
	 * Wiring: we build a {@link SessionRunner} from the supplied config and
	 * feed every keystroke event into it. Once the text is fully typed we
	 * finalize, persist, and redirect. Keeps all three session routes
	 * (diagnostic, bigram-drill, real-text) from duplicating the same ~100 lines.
	 */
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { SvelteSet } from 'svelte/reactivity';
	import TypingSurface from '$lib/typing/TypingSurface.svelte';
	import type { KeystrokeEvent } from '$lib/typing';
	import type { DiagnosticReport, DrillMode, SessionType, SessionSummary } from '$lib/core';
	import { SessionRunner } from '../runner';
	import { computeGhostPosition, paceForMode } from '../pacer';
	import { saveSession } from '../persistence';
	import Timer from './Timer.svelte';
	import StatsBar from './StatsBar.svelte';

	interface Props {
		/** Session kind — drives the persisted summary's `type` field. */
		type: SessionType;
		text: string;
		title: string;
		/** One-sentence explanation of what this session actually does. */
		what?: string;
		/** One-sentence guidance on how the user should type through it. */
		approach?: string;
		/** Drill targets, recorded on the summary for later analysis. */
		targetBigrams?: readonly string[];
		/**
		 * Subset of `targetBigrams` that are exposure backfill (not diagnosed
		 * weaknesses). Renders in the dashed style; anything not in this list
		 * is treated as priority.
		 */
		exposureBigrams?: readonly string[];
		/**
		 * Drill treatment mode. Recorded on the persisted summary and drives
		 * the pacer speed (accuracy → 0.60× baseline, speed → 1.17× baseline).
		 * Undefined for non-drill types.
		 */
		drillMode?: DrillMode;
		/**
		 * User's current baseline WPM, from the latest diagnostic report.
		 * Needed by the pacer to derive a real-time ghost cursor. Absent on
		 * first-run / no-diagnostic state, in which case the pacer is hidden.
		 */
		baselineWPM?: number;
		/**
		 * Diagnostic routes pass a builder that turns the just-finalized summary
		 * (plus its raw events, available in-memory only for this call) into a
		 * `DiagnosticReport` which is attached to the summary before persistence.
		 * Keeps the shell type-agnostic — the diagnostic route owns the corpus
		 * frequencies the engine needs.
		 */
		buildDiagnosticReport?: (
			summary: SessionSummary,
			events: readonly KeystrokeEvent[]
		) => DiagnosticReport;
	}

	let {
		type,
		text,
		title,
		what,
		approach,
		targetBigrams,
		exposureBigrams,
		drillMode,
		baselineWPM,
		buildDiagnosticReport
	}: Props = $props();

	const exposureSet = $derived(new Set(exposureBigrams ?? []));
	// Legend only shows when both chip styles are actually on screen.
	const hasMix = $derived(
		!!exposureBigrams &&
			exposureBigrams.length > 0 &&
			!!targetBigrams &&
			targetBigrams.some((b) => !exposureSet.has(b))
	);

	// Reactive mirrors of runner state. The runner itself is plain TS with
	// no reactivity; we shadow the bits the UI reads in $state so the
	// rendered readouts update correctly.
	let position = $state(0);
	const errorPositions = new SvelteSet<number>();
	const correctedPositions = new SvelteSet<number>();
	let errorCount = $state(0);
	let elapsedMs = $state(0);
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
		text,
		targetBigrams,
		drillMode
	});

	const progressPct = $derived(Math.round((position / text.length) * 100));

	// Pacer wiring. `paceWPM` resolves to 0 when either the session isn't a
	// drill or the user has no diagnostic baseline — `ghostPosition` stays
	// undefined in that case, which TextDisplay interprets as "no pacer."
	// Only read `elapsedMs` once `running` is true so the ghost doesn't crawl
	// forward before the first keystroke (reading/focus time shouldn't count).
	const paceWPM = $derived(drillMode && baselineWPM ? paceForMode(drillMode, baselineWPM) : 0);
	const ghostPosition = $derived(
		paceWPM > 0 && running ? computeGhostPosition(elapsedMs, paceWPM) : undefined
	);
	// ms-per-char at the current pace. Passed to TextDisplay so the ghost
	// overlay's CSS transition takes exactly that long to slide between
	// consecutive chars — the next boundary arrives precisely when the
	// slide ends, producing continuous motion. 5 chars = 1 word.
	const ghostTransitionMs = $derived(paceWPM > 0 ? 60_000 / (paceWPM * 5) : 0);
	// Speed drills want forward pressure (ghost ahead); accuracy drills
	// want slow-down pressure (ghost behind, visible only when the user
	// has outrun the target pace).
	const ghostVisibility = $derived<'ahead' | 'behind'>(
		drillMode === 'accuracy' ? 'behind' : 'ahead'
	);

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
		if (event.actual !== event.expected) {
			if (!errorPositions.has(event.position)) errorCount++;
			errorPositions.add(event.position);
		} else if (errorPositions.has(event.position)) {
			correctedPositions.add(event.position);
		}

		// Finalize as soon as the last char is typed rather than waiting for the next timer tick.
		if (runner.isComplete()) finalizeAndNavigate();
	}

	async function finalizeAndNavigate() {
		if (saving || !running) return;
		running = false;
		saving = true;
		try {
			const elapsed = performance.now() - (sessionStart ?? performance.now());
			const summary: SessionSummary = runner.finalize(elapsed);
			if (buildDiagnosticReport) {
				summary.diagnosticReport = buildDiagnosticReport(summary, runner.events);
			}
			await saveSession(summary);
			await goto(resolve('/session/[id]/summary', { id: summary.id }));
		} catch (err) {
			saving = false;
			saveError = err instanceof Error ? err.message : 'Failed to save session.';
		}
	}

	// Clock. Driven by requestAnimationFrame so the pacer ghost advances
	// in lockstep with the display refresh — at 200ms setInterval cadence
	// the ghost visibly stutters next to the real cursor (which moves on
	// every keystroke). rAF is cheap here: Svelte's fine-grained reactivity
	// only re-renders the Timer's mm:ss span when the second rolls over,
	// and only repaints the ghost when its char index changes.
	$effect(() => {
		if (!running) return;
		const anchor = performance.now() - elapsedMs;
		let frame = 0;
		const tick = () => {
			elapsedMs = performance.now() - anchor;
			frame = window.requestAnimationFrame(tick);
		};
		frame = window.requestAnimationFrame(tick);
		return () => window.cancelAnimationFrame(frame);
	});
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
		<h1 class="text-4xl font-semibold tracking-tight">{title}</h1>
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

		{#if targetBigrams && targetBigrams.length > 0}
			<!--
				Same grid as the dl above, so the `DRILLING` label sits in
				the same column as `WHAT / HOW`. Separated from the briefing
				by a hairline to mark "this is data you'll look at while
				typing," not more prose.
			-->
			<div
				class="grid max-w-xl grid-cols-[5rem_1fr] items-baseline gap-x-4 gap-y-2 border-t border-base-300 pt-4"
			>
				<span class="text-[11px] font-medium tracking-[0.18em] text-base-content/40 uppercase">
					Drilling
				</span>
				<ul class="flex flex-wrap gap-1.5" aria-label="Drill targets">
					{#each targetBigrams as bigram (bigram)}
						{@const isExposure = exposureSet.has(bigram)}
						<!-- Filled = priority, dashed = exposure. aria carries the same distinction. -->
						<li
							class="rounded-sm px-2 py-0.5 font-mono text-xs {isExposure
								? 'border border-dashed border-base-content/40 text-base-content/60'
								: 'bg-base-200 text-base-content/80'}"
							aria-label={isExposure
								? `${bigram}, new bigram for exposure practice`
								: `${bigram}, diagnosed weakness`}
						>
							<!--
								Bigrams may contain whitespace (space→letter and letter→space
								are among the most frequent real-typing transitions). Render
								the literal space as a dimmed open-box glyph so "␣t" and "t"
								are visibly distinct.
							-->
							{#each bigram as char, i (i)}{#if char === ' '}<span
										class="text-base-content/35"
										aria-label="space">␣</span
									>{:else}{char}{/if}{/each}
						</li>
					{/each}
				</ul>
				{#if hasMix}
					<span></span>
					<p class="text-[11px] text-base-content/50">
						<span
							class="mr-1 inline-block rounded-sm bg-base-200 px-1.5 py-0.5 align-middle font-mono text-base-content/80"
							>ab</span
						>
						diagnosed weakness ·
						<span
							class="mx-1 inline-block rounded-sm border border-dashed border-base-content/40 px-1.5 py-0.5 align-middle font-mono text-base-content/60"
							>cd</span
						>
						new bigram — not enough data yet
					</p>
				{/if}
			</div>
		{/if}
	</header>

	<!--
		Ambient progress: hairline bar above the drill. Doubles as a visible
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
			{ghostPosition}
			{ghostTransitionMs}
			{ghostVisibility}
			{onEvent}
		/>
	</div>

	<div class="flex flex-wrap items-baseline gap-x-6 gap-y-2 text-sm">
		<Timer {elapsedMs} />
		<StatsBar {errorCount} />
		{#if saving}
			<span class="text-base-content/55">Saving…</span>
		{/if}
		{#if saveError}
			<span class="text-error" role="alert">{saveError}</span>
		{/if}
	</div>
</div>
