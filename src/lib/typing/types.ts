/**
 * Atomic unit captured during any session. Persisted only for diagnostics
 * (so thresholds can be replayed later — spec §2.1). `corrected` and
 * `correctionDelay` are derived in post-processing, not stored here.
 */
export interface KeystrokeEvent {
	/** Ms since session start, via `performance.now()`. */
	timestamp: number;
	expected: string;
	actual: string;
	position: number;
	wordIndex: number;
	/** Index within the current word; 0 = word-initial. */
	positionInWord: number;
}

/** Input to the capture layer. Stays domain-agnostic — no bigrams in here. */
export interface CaptureConfig {
	text: string;
	correctionWindowMs?: number;
}

/**
 * A backspace within this window of the mistyped keystroke counts as a
 * correction of that keystroke. Beyond it, the backspace is an independent
 * edit and the original error stays on the record.
 */
export const DEFAULT_CORRECTION_WINDOW_MS = 500;
