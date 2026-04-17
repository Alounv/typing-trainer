import { v4 as uuid } from 'uuid';
import type { KeystrokeEvent } from '../typing/types';
import { annotateFirstInputs } from '../typing/postprocess';
import { extractBigramAggregates } from '../bigram/extraction';
import type { ClassificationThresholds } from '../bigram/classification';
import type { SessionSummary, SessionType } from './types';
import { checkBigramGraduation, type BigramOccurrence } from './graduation';

/**
 * Inputs for turning a finished capture into a persistable summary.
 * `events` is the raw log (retypes included); this function annotates them
 * before bigram extraction so callers don't have to remember that.
 */
export interface BuildSessionSummaryInput {
	events: readonly KeystrokeEvent[];
	type: SessionType;
	/** Total drill length in characters — needed because `events` only covers what the user actually typed if they aborted. */
	textLength: number;
	/** `performance.now()` relative duration of the session in ms. */
	durationMs: number;
	bigramsTargeted?: string[];
	/** Override the default classification thresholds. */
	thresholds?: ClassificationThresholds;
	/** Injectable for tests; defaults to `uuid()` + `Date.now()`. */
	idGenerator?: () => string;
	timestampProvider?: () => number;
}

/**
 * Pure transform: raw keystroke log → persistable `SessionSummary`. Id and
 * timestamp are the only non-determinism, both injectable for tests.
 * Bigram timings use first-input-only events; raw events are archived separately.
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
 * Raw WPM — smoothing lives in `progress/`. 5 chars = 1 word. Uses `textLength`
 * (not event count) so aborted sessions don't inflate the rate. Returns 0 for
 * zero-duration sessions.
 */
function computeWPM(textLength: number, durationMs: number): number {
	if (durationMs <= 0) return 0;
	const minutes = durationMs / 60_000;
	return textLength / 5 / minutes;
}

/** Fraction of first-input positions where the user typed the wrong char. Retypes don't count. */
function computeErrorRate(annotated: readonly { expected: string; actual: string }[]): number {
	if (annotated.length === 0) return 0;
	let errors = 0;
	for (const e of annotated) if (e.actual !== e.expected) errors++;
	return errors / annotated.length;
}

// SessionRunner: plain TS lifecycle manager for an in-flight session.
// UI wraps getter output in its own reactive state.

/**
 * Why a session ended; `null` in `shouldEnd` means "keep going". No `'timeout'`:
 * sessions run until text completes, or (drill only) every target graduates.
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
	/** Fired each time a target bigram satisfies graduation. */
	onBigramGraduated?: (bigram: string) => void;
	/** Override classification thresholds for the final summary. */
	thresholds?: ClassificationThresholds;
}

/**
 * In-flight session manager (pure TS; no timers). UI calls `recordEvent` per
 * keystroke, `shouldEnd()` when done, and `finalize(elapsedMs)` to persist.
 * The runner doesn't own the clock — tests fast-forward synthetic time freely.
 */
export class SessionRunner {
	private readonly config: SessionRunnerConfig;
	private readonly events_: KeystrokeEvent[] = [];
	private readonly targetOccurrences = new Map<string, BigramOccurrence[]>();
	private readonly graduated_ = new Set<string>();
	private position_ = 0;

	constructor(config: SessionRunnerConfig) {
		this.config = config;
		// Pre-create occurrence buckets so tests can inspect tracked bigrams
		// before any events arrive.
		for (const t of config.targetBigrams ?? []) {
			this.targetOccurrences.set(t, []);
		}
	}

	/**
	 * Record a keystroke. Appends to the log, advances position, and (for drill
	 * sessions) updates per-target occurrences + checks graduation.
	 */
	recordEvent(event: KeystrokeEvent): void {
		this.events_.push(event);
		// `Math.max` defends against out-of-order events; position only moves forward.
		this.position_ = Math.max(this.position_, event.position + 1);

		if (this.events_.length < 2) return;
		const prev = this.events_[this.events_.length - 2];
		// Only adjacent (left, right) pairs form a bigram. A retype at the same
		// position after backspace has `prev.position === event.position`, so it
		// produces no new occurrence — matches "first input sticks".
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

	/** Should the session end now? Called after each event. No time-gating. */
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
