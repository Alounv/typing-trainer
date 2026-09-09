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
	/**
	 * Recomputed on read for rows that carry a `stream`. On legacy rows it is
	 * frozen at whatever the thresholds were that day, and cannot be re-scored.
	 */
	classification: BigramClassification;
	/** Absent on legacy rows; consumers fall back to the scalars above. */
	samples?: BigramSample[];
}

/**
 * `real-text` is the only type produced now. The other two remain because
 * stored rows carry them, and pacing must not compare across types — drill
 * passages were bigram-dense and typed slower than prose.
 */
type SessionType = 'diagnostic' | 'bigram-drill' | 'real-text';

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
	type: SessionType;
	durationMs: number;
	/** Raw. Smoothing lives in `progress/`. */
	wpm: number;
	errorRate: number;
	/** Absent on legacy rows, which is why theirs cannot be re-measured. */
	text?: string;
	stream?: KeystrokeStream;
	/**
	 * Derived from `stream` on read rather than persisted, which is what makes
	 * a threshold change re-score history instead of only future sessions.
	 */
	bigramAggregates: BigramAggregate[];
}

/**
 * Aggregates are absent on rows written from schema v2 on: persisting them
 * would be a second, staler source of the same truth. Legacy rows are the
 * mirror image — aggregates, no stream.
 */
export interface StoredSession extends Omit<SessionSummary, 'bigramAggregates'> {
	bigramAggregates?: BigramAggregate[];
}

export type Language = 'en' | 'fr';

export interface UserSettings {
	language: Language;
	secondaryLanguage?: Language;
	/** 0..100 share of draws taken from `secondaryLanguage`. */
	secondaryMix?: number;
	/** No longer editable in the UI: changing it re-scores every past session. */
	thresholds?: ClassificationThresholds;
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
