/**
 * Atomic keystroke unit. Persisted only for diagnostics (so thresholds can be
 * replayed). `corrected`/`correctionDelay` are derived in post-processing.
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
