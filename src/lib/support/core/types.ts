/** Cross-lib domain types. `core` is a DAG leaf: no runtime, no `$lib/*` imports. */

/**
 * Ordered worst to best for training purposes: `acquisition` (slow and wrong)
 * · `hasty` (fast but wrong) · `fluency` (right but slow) · `healthy`.
 * Errors outrank slowness, which is why `hasty` sits below `fluency`.
 */
export type BigramClassification = 'healthy' | 'fluency' | 'hasty' | 'acquisition' | 'unclassified';

export interface ClassificationThresholds {
	/** At or under this, a bigram counts as fast (ms). */
	speedMs: number;
	/** At or above this, error-prone (0..1). */
	errorRate: number;
}

/** Kept in observation order, so a window can pool the last N across sessions. */
export interface BigramSample {
	correct: boolean;
	/** `null` when either keystroke was wrong — an error is never also a timing. */
	timing: number | null;
}

export interface BigramAggregate {
	bigram: string;
	sessionId: string;
	occurrences: number;
	/** First inputs only; correction time excluded. */
	meanTime: number;
	stdTime: number;
	/** First-input errors — a backspace does not erase one. */
	errorCount: number;
	errorRate: number;
	classification: BigramClassification;
	samples: BigramSample[];
}

/**
 * Columnar rather than an array of objects so IndexedDB stores the numeric
 * columns as binary through structured clone — the object form costs roughly
 * fourteen times as much for the same information.
 *
 * All three columns share one index space: entry `i` is the `i`-th keystroke.
 */
export interface KeystrokeStream {
	/** Deltas. Almost always `1`; a retype after backspacing goes negative. */
	positions: Int16Array;
	/** Whole-ms deltas; entry 0 is measured from session start. */
	times: Uint32Array;
	typed: string;
}

export interface SessionSummary {
	id: string;
	timestamp: number;
	durationMs: number;
	/** Raw. Smoothing lives in `progress/`. */
	wpm: number;
	errorRate: number;
	text: string;
	stream: KeystrokeStream;
	/**
	 * The bank the passage was drawn from. A mixed passage takes its primary
	 * language, since the secondary is a minority share by design. Absent on rows
	 * written before the field existed, which is what keeps them out of a new
	 * session's pacing baseline.
	 */
	language?: Language;
	/**
	 * Derived from `stream` on read rather than persisted, which is what makes
	 * a threshold change re-score history instead of only future sessions.
	 */
	bigramAggregates: BigramAggregate[];
}

/**
 * Aggregates are never persisted — they would be a second, staler source of the
 * same truth as `stream`.
 */
export type StoredSession = Omit<SessionSummary, 'bigramAggregates'>;

export type Language = 'en' | 'fr';

export interface UserSettings {
	language: Language;
	secondaryLanguage?: Language;
	/** 0..100 share of draws taken from `secondaryLanguage`. */
	secondaryMix?: number;
	passageWords?: number;
	/** The opening state only — the in-session toggle overrides it either way. */
	colorizeBigramDifficulty?: boolean;
}

/**
 * The in-memory shape, produced live by capture and rebuilt from a stored
 * {@link KeystrokeStream} on read. Only `position`, `actual` and `timestamp`
 * survive a round-trip; the rest are recomputed from the text.
 */
export interface KeystrokeEvent {
	/** Ms since session start, via `performance.now()`. */
	timestamp: number;
	expected: string;
	actual: string;
	position: number;
	wordIndex: number;
	positionInWord: number;
}

export interface CaptureConfig {
	text: string;
	correctionWindowMs?: number;
}
