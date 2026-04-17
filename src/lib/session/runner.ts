import { v4 as uuid } from 'uuid';
import type { KeystrokeEvent } from '../typing/types';
import { annotateFirstInputs } from '../typing/postprocess';
import { extractBigramAggregates } from '../bigram/extraction';
import type { ClassificationThresholds } from '../bigram/classification';
import type { SessionSummary, SessionType } from './types';
import { checkBigramGraduation, type BigramOccurrence } from './graduation';

/**
 * Inputs needed to turn a finished capture into a persistable summary.
 *
 * `events` is the raw log straight from `keystrokeCapture` — retypes and all.
 * The runner is responsible for collapsing them via `annotateFirstInputs`
 * before feeding the bigram extractor; upstream callers shouldn't have to
 * remember that invariant.
 */
export interface BuildSessionSummaryInput {
	events: readonly KeystrokeEvent[];
	type: SessionType;
	/** Total drill length in characters — needed because `events` only covers what the user actually typed if they aborted. */
	textLength: number;
	/** `performance.now()` relative duration of the session in ms. */
	durationMs: number;
	bigramsTargeted?: string[];
	/** Override the default classification thresholds (spec §3.1). */
	thresholds?: ClassificationThresholds;
	/** Injectable for tests; defaults to `uuid()` + `Date.now()`. */
	idGenerator?: () => string;
	timestampProvider?: () => number;
}

/**
 * Pure transform: raw keystroke log → persistable `SessionSummary`.
 *
 * No Svelte, no IO. The only non-determinism is the session id and timestamp,
 * both injectable for tests. Caller decides whether to persist the result.
 *
 * Bigram timings use the annotated (first-input-only) events so retypes never
 * inflate the occurrence count; raw events are still what upstream would
 * archive for a diagnostic session.
 */
export function buildSessionSummary(input: BuildSessionSummaryInput): SessionSummary {
	const id = (input.idGenerator ?? uuid)();
	const timestamp = (input.timestampProvider ?? Date.now)();
	const annotated = annotateFirstInputs(input.events);
	const bigramAggregates = extractBigramAggregates(annotated, id, input.thresholds);

	return {
		id,
		timestamp,
		type: input.type,
		durationMs: input.durationMs,
		wpm: computeWPM(input.textLength, input.durationMs),
		errorRate: computeErrorRate(annotated),
		bigramsTargeted: input.bigramsTargeted,
		bigramAggregates
	};
}

/**
 * Raw WPM — never smoothed (smoothing lives in `progress/`). Spec convention:
 * 5 characters = 1 word. Uses `textLength` rather than typed-event count so
 * aborted sessions don't inflate the rate.
 *
 * Returns 0 for a zero-duration session — caller decides whether that's a
 * meaningful save or a discard.
 */
function computeWPM(textLength: number, durationMs: number): number {
	if (durationMs <= 0) return 0;
	const minutes = durationMs / 60_000;
	return textLength / 5 / minutes;
}

/**
 * Fraction of first-input positions where the user typed the wrong char.
 * Retypes don't count — the first input sticks (spec §2.2). 0 for an empty
 * event log.
 */
function computeErrorRate(annotated: readonly { expected: string; actual: string }[]): number {
	if (annotated.length === 0) return 0;
	let errors = 0;
	for (const e of annotated) if (e.actual !== e.expected) errors++;
	return errors / annotated.length;
}

/* -----------------------------------------------------------------------
 * SessionRunner — in-flight session lifecycle manager.
 *
 * Plain TS, no Svelte. The UI wraps the runner's getter output in its
 * own reactive state ($state/$derived) — the runner emits callbacks at
 * notable moments, but doesn't push reactivity through itself.
 * --------------------------------------------------------------------- */

/**
 * Why a session ended. `null` in `shouldEnd` means "keep going".
 *
 * There's no `'timeout'` reason: all session types run until their
 * (pre-sized) text is complete. Drills additionally short-circuit when
 * every target bigram has graduated. The text length is the time budget
 * — caller derives it from the user's baseline WPM × desired minutes,
 * so a slow typist gets a longer stretch of wall-clock time from the
 * same word count and nothing feels arbitrarily cut short.
 */
export type SessionEndReason = 'complete' | 'all-graduated';

export interface SessionRunnerConfig {
	type: SessionType;
	text: string;
	/**
	 * Target bigrams for a drill session. When set, the runner maintains
	 * per-target occurrence lists and (if `graduationTargetMs` is also
	 * set) evaluates graduation after each occurrence. Absent for
	 * diagnostic/real-text sessions.
	 */
	targetBigrams?: readonly string[];
	/**
	 * Phase speed target in ms per transition. Only meaningful for drill
	 * sessions — `checkBigramGraduation` is skipped when this is
	 * `undefined`. Convert from WPM via `phaseTargetMsFromWPM` upstream.
	 */
	graduationTargetMs?: number;
	/** Injectable so tests get deterministic ids. */
	idGenerator?: () => string;
	/** Injectable so tests get deterministic timestamps for `finalize`. */
	timestampProvider?: () => number;
	/** Fired each time a target bigram satisfies spec §4.1 graduation. */
	onBigramGraduated?: (bigram: string) => void;
	/** Override classification thresholds for the final summary. */
	thresholds?: ClassificationThresholds;
}

/**
 * Manages one running session. The UI calls `recordEvent` per keystroke
 * and polls `shouldEnd(elapsedMs)` per tick. When ready to persist, call
 * `finalize(elapsedMs)` to get a {@link SessionSummary} and route to the
 * summary page.
 *
 * The runner does NOT own the clock — UI decides the tick cadence and
 * pushes `elapsedMs` in. Keeps the runner pure (no timer side-effects)
 * and lets tests fast-forward synthetic time without timers.
 */
export class SessionRunner {
	private readonly config: SessionRunnerConfig;
	private readonly events_: KeystrokeEvent[] = [];
	private readonly targetOccurrences = new Map<string, BigramOccurrence[]>();
	private readonly graduated_ = new Set<string>();
	private position_ = 0;

	constructor(config: SessionRunnerConfig) {
		this.config = config;
		// Pre-create the occurrence buckets so tests can inspect the set of
		// tracked bigrams even before any events arrive.
		for (const t of config.targetBigrams ?? []) {
			this.targetOccurrences.set(t, []);
		}
	}

	/**
	 * Record a keystroke event from the typing surface. Appends to the
	 * event log, updates the position, and (for drill sessions) updates
	 * per-target occurrence lists and checks graduation.
	 */
	recordEvent(event: KeystrokeEvent): void {
		this.events_.push(event);
		// Event position is the slot where the keystroke landed; the cursor
		// advances to the slot immediately after. `Math.max` defends against
		// a replay-style caller feeding events out of order — position
		// should only move forward from the runner's view.
		this.position_ = Math.max(this.position_, event.position + 1);

		if (this.events_.length < 2) return;
		const prev = this.events_[this.events_.length - 2];
		// Only adjacent (left, right) pairs form a bigram occurrence. A
		// retype at the same position (after backspace) has `prev.position
		// === event.position`, so it produces no new occurrence — matches
		// the "first input sticks" rule (spec §2.2).
		if (prev.position !== event.position - 1) return;

		const bigram = prev.expected + event.expected;
		const bucket = this.targetOccurrences.get(bigram);
		if (!bucket || this.graduated_.has(bigram)) return;

		bucket.push({
			correct: event.actual === event.expected,
			transitionMs: event.timestamp - prev.timestamp
		});

		if (this.config.graduationTargetMs !== undefined) {
			const result = checkBigramGraduation({
				recent: bucket,
				phaseTargetMs: this.config.graduationTargetMs
			});
			if (result.graduated) {
				this.graduated_.add(bigram);
				this.config.onBigramGraduated?.(bigram);
			}
		}
	}

	/**
	 * Decide whether the session should end. Called by the UI on every
	 * event (and optionally per timer tick). Takes no time argument —
	 * nothing here is time-gated any more.
	 */
	shouldEnd(): SessionEndReason | null {
		if (this.position_ >= this.config.text.length) return 'complete';
		if (
			this.config.targetBigrams &&
			this.config.targetBigrams.length > 0 &&
			this.graduated_.size === this.config.targetBigrams.length
		) {
			return 'all-graduated';
		}
		return null;
	}

	/** Produce a persistable summary from the accumulated events. */
	finalize(elapsedMs: number): SessionSummary {
		return buildSessionSummary({
			events: this.events_,
			type: this.config.type,
			textLength: this.config.text.length,
			durationMs: elapsedMs,
			bigramsTargeted: this.config.targetBigrams ? [...this.config.targetBigrams] : undefined,
			thresholds: this.config.thresholds,
			idGenerator: this.config.idGenerator,
			timestampProvider: this.config.timestampProvider
		});
	}

	/** Snapshot of events captured so far. Callers should treat as read-only. */
	get events(): readonly KeystrokeEvent[] {
		return this.events_;
	}

	/** Current cursor position (index of the next char to type). */
	get position(): number {
		return this.position_;
	}

	/** Set of target bigrams that have met graduation criteria. */
	get graduatedTargets(): readonly string[] {
		return [...this.graduated_];
	}
}
