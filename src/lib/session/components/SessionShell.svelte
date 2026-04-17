<script lang="ts">
	/**
	 * One-stop shell for any session type. Composes:
	 *   - a title + lede (per session type)
	 *   - a thin progress bar above the drill
	 *   - the typing surface with live error / corrected-state tracking
	 *   - a Timer + StatsBar row
	 *
	 * Wiring: we build a {@link SessionRunner} from the supplied config and
	 * feed every keystroke event into it. On each event we also consult
	 * `runner.shouldEnd()` — if the session should stop (text complete or
	 * all targets graduated) we finalize, persist, and redirect. Keeps all
	 * three session routes (diagnostic, bigram-drill, real-text) from
	 * duplicating the same ~100 lines.
	 */
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { SvelteSet } from 'svelte/reactivity';
	import TypingSurface from '$lib/typing/TypingSurface.svelte';
	import type { KeystrokeEvent } from '$lib/typing/types';
	import type { SessionType, SessionSummary } from '$lib/session/types';
	import type { DiagnosticRawData } from '$lib/diagnostic/types';
	import { SessionRunner } from '$lib/session/runner';
	import { saveSession } from '$lib/storage/service';
	import Timer from './Timer.svelte';
	import StatsBar from './StatsBar.svelte';

	interface Props {
		/** Session kind — drives the persisted summary's `type` field. */
		type: SessionType;
		text: string;
		title: string;
		lede?: string;
		/** Drill targets. Enables per-bigram graduation tracking when supplied. */
		targetBigrams?: readonly string[];
		/**
		 * Phase target ms per bigram transition. When set together with
		 * `targetBigrams`, each occurrence runs through the graduation
		 * check; targets fire `onBigramGraduated` individually.
		 */
		graduationTargetMs?: number;
		/**
		 * Diagnostic sessions archive their raw event log (spec §2.8) so
		 * thresholds can be replayed later. `true` → we persist
		 * {@link DiagnosticRawData} alongside the summary. Defaults to
		 * `false`; diagnostic routes flip it on.
		 */
		persistRawEvents?: boolean;
		/**
		 * Char offsets where round boundaries fall — one per round except
		 * the final. Shell shows a round indicator and fires a brief
		 * transition toast as each boundary is crossed. Empty/omitted =
		 * no round UI (diagnostic is always single-round).
		 */
		roundBoundaries?: readonly number[];
		/** Total rounds in the session; 1 = no round UI. */
		roundCount?: number;
	}

	let {
		type,
		text,
		title,
		lede,
		targetBigrams,
		graduationTargetMs,
		persistRawEvents = false,
		roundBoundaries = [],
		roundCount = 1
	}: Props = $props();

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
	let graduatedCount = $state(0);

	/**
	 * Zero-indexed round the user is currently in (0 = first round).
	 * Advances via the runner's `onRoundComplete` callback. Visible in
	 * the UI as "Round N of M" so the user sees intermediate progress
	 * instead of one long undifferentiated block.
	 */
	let currentRound = $state(0);
	/**
	 * Index of the most recently completed round, used to drive the
	 * brief transition toast. `null` means nothing to show (initial
	 * state or after the toast's auto-dismiss timer fires).
	 */
	let transitionRound = $state<number | null>(null);
	/** Characters correctly typed within the current round (for the toast's accuracy stat). */
	let roundCorrectChars = $state(0);
	/** Total chars committed within the current round — same denominator used for accuracy. */
	let roundTotalChars = $state(0);
	/** Last round's accuracy %, shown by the toast. Recomputed at each transition. */
	let lastRoundAccuracy = $state(100);

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
		graduationTargetMs,
		roundBoundaries,
		onRoundComplete: (i) => {
			// Snapshot accuracy for the round that just ended, then reset
			// round-local counters for the next round. The toast below
			// reads `lastRoundAccuracy` plus `transitionRound`.
			lastRoundAccuracy =
				roundTotalChars === 0 ? 100 : Math.round((roundCorrectChars / roundTotalChars) * 100);
			roundCorrectChars = 0;
			roundTotalChars = 0;
			currentRound = i + 1;
			transitionRound = i;
		},
		onBigramGraduated: () => {
			graduatedCount = runner.graduatedTargets.length;
		}
	});

	const progressPct = $derived(Math.round((position / text.length) * 100));

	function onEvent(event: KeystrokeEvent) {
		if (sessionStart === null) {
			sessionStart = performance.now();
			running = true;
		}
		// Per-round accuracy tracking (first-input only, same rule as
		// session-level errorRate). Done before `recordEvent` so the
		// counters are already updated when a boundary crossing fires
		// `onRoundComplete` inside the runner.
		if (event.position >= 0 && event.position < text.length) {
			// Only count the first input at each position — retypes after
			// backspace shouldn't get a second chance to "fix" accuracy.
			if (!errorPositions.has(event.position) && !correctedPositions.has(event.position)) {
				roundTotalChars++;
				if (event.actual === event.expected) roundCorrectChars++;
			}
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

		// End-on-event check: if this keystroke completed the text or
		// graduated the final target, finalize immediately rather than
		// waiting for the next timer tick.
		if (runner.shouldEnd()) finalizeAndNavigate();
	}

	async function finalizeAndNavigate() {
		if (saving || !running) return;
		running = false;
		saving = true;
		try {
			const elapsed = performance.now() - (sessionStart ?? performance.now());
			const summary: SessionSummary = runner.finalize(elapsed);
			const rawData: DiagnosticRawData | undefined = persistRawEvents
				? { sessionId: summary.id, events: [...runner.events] }
				: undefined;
			await saveSession(summary, rawData);
			await goto(resolve('/session/[id]/summary', { id: summary.id }));
		} catch (err) {
			saving = false;
			saveError = err instanceof Error ? err.message : 'Failed to save session.';
		}
	}

	// Clock. Ticks at 200ms — fast enough for the WPM readout to feel
	// live, slow enough that re-computing doesn't thrash on every
	// keystroke. `performance.now()` for spec-level precision.
	$effect(() => {
		if (!running) return;
		const anchor = performance.now() - elapsedMs;
		const id = window.setInterval(() => {
			elapsedMs = performance.now() - anchor;
		}, 200);
		return () => window.clearInterval(id);
	});

	/** How long the round-transition toast lingers before auto-dismissing. */
	const ROUND_TOAST_MS = 1500;
	// Auto-dismiss the round-transition toast. Tracked by `transitionRound`
	// so each boundary fires a fresh timer and a rapid-fire sequence of
	// transitions doesn't pile up overlapping toasts.
	$effect(() => {
		if (transitionRound === null) return;
		const id = window.setTimeout(() => {
			transitionRound = null;
		}, ROUND_TOAST_MS);
		return () => window.clearTimeout(id);
	});

	const showRoundIndicator = $derived(roundCount > 1);
</script>

<div class="relative mx-auto max-w-3xl space-y-8">
	<header class="space-y-2">
		<h1 class="text-4xl font-bold tracking-tight">{title}</h1>
		{#if lede}<p class="text-base-content/70">{lede}</p>{/if}
	</header>

	{#if transitionRound !== null}
		<!--
			Transition toast — brief, auto-dismissing marker that the round
			just ended. Shows round number + accuracy. Non-blocking: input
			keeps working; this is a progress landmark, not a pause screen.
			`role="status"` with polite live region so screen readers pick
			it up without interrupting.
		-->
		<div
			class="pointer-events-none absolute -top-2 right-0 left-0 flex justify-center"
			role="status"
			aria-live="polite"
		>
			<div
				class="rounded-full border border-base-300 bg-base-100 px-4 py-2 text-sm shadow-md"
				data-testid="round-transition-toast"
			>
				<span class="font-medium">Round {transitionRound + 1} of {roundCount}</span>
				<span class="text-base-content/50"> · {lastRoundAccuracy}% accurate</span>
			</div>
		</div>
	{/if}

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

		<TypingSurface {text} bind:position {errorPositions} {correctedPositions} {onEvent} />
	</div>

	<div class="flex flex-wrap items-baseline gap-x-6 gap-y-2 text-sm">
		<Timer {elapsedMs} />
		<StatsBar {position} {elapsedMs} {errorCount} />
		{#if showRoundIndicator}
			<span class="flex items-baseline gap-1.5" data-testid="round-indicator">
				<span class="text-base-content/55">Round</span>
				<span class="font-mono font-medium text-base-content tabular-nums">
					{Math.min(currentRound + 1, roundCount)}<span class="text-base-content/40"
						>/{roundCount}</span
					>
				</span>
			</span>
		{/if}
		{#if targetBigrams && targetBigrams.length > 0}
			<span class="flex items-baseline gap-1.5">
				<span class="text-base-content/55">Graduated</span>
				<span class="font-mono font-medium text-base-content tabular-nums">
					{graduatedCount}<span class="text-base-content/40">/{targetBigrams.length}</span>
				</span>
			</span>
		{/if}
		{#if saving}
			<span class="text-base-content/55">Saving…</span>
		{/if}
		{#if saveError}
			<span class="text-error" role="alert">{saveError}</span>
		{/if}
	</div>
</div>
