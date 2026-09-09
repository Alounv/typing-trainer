/** Cross-lib domain types. `core` is a DAG leaf: no runtime, no `$lib/*` imports. */

/**
 * Maps to training prescription: `healthy` (skip) · `fluency` (speed bursts) ·
 * `hasty` (slow reps) · `acquisition` (blocked slow drill) · `unclassified` (undertrained).
 */
export type BigramClassification = 'healthy' | 'fluency' | 'hasty' | 'acquisition' | 'unclassified';

/** Thresholds driving the four-way bigram classification. Overridable via `UserSettings.thresholds`. */
export interface ClassificationThresholds {
	/** Mean transition time at/under which a bigram counts as fast (ms). */
	speedMs: number;
	/** Error rate at/above which a bigram counts as error-prone (0..1). */
	errorRate: number;
}

/**
 * Per-occurrence bigram record. Kept in observation order so sliding-window
 * classification (see `progress/metrics`) can pool the last N across sessions.
 */
export interface BigramSample {
	correct: boolean;
	/** ms transition time for clean pairs; `null` when either side was wrong. */
	timing: number | null;
}

/**
 * One row per bigram per session. `classification` snapshots session-time
 * thresholds — never recomputed, so historical records stay stable.
 */
export interface BigramAggregate {
	bigram: string;
	sessionId: string;
	occurrences: number;
	/** First inputs only — correction time excluded. */
	meanTime: number;
	stdTime: number;
	/** First-input errors; backspace does not erase. */
	errorCount: number;
	errorRate: number;
	classification: BigramClassification;
	/** Absent on legacy pre-sliding-window records; consumers fall back to scalars. */
	samples?: BigramSample[];
}

/**
 * `real-text` is the only type produced now. `diagnostic` and `bigram-drill`
 * remain because stored rows carry them — history has to stay readable.
 */
type SessionType = 'diagnostic' | 'bigram-drill' | 'real-text';

/**
 * A session's keystroke log in compact columnar form.
 *
 * Columnar rather than an array of objects so IndexedDB stores the numeric
 * columns as binary through structured clone — the object form costs roughly
 * fourteen times as much for the same information.
 *
 * All three columns share one index space: entry `i` is the `i`-th keystroke.
 * `positions` and `times` hold deltas from the previous entry (entry 0 is
 * absolute), which keeps both columns full of small numbers.
 *
 * This is the session's evidence. Every bigram statistic in the app is a
 * reading of it, never the other way round — see `session/stream-codec`.
 */
export interface KeystrokeStream {
	/** Position deltas. Almost always `1`; a retype after backspacing goes negative. */
	positions: Int16Array;
	/** Whole-ms deltas since the previous keystroke; entry 0 is since session start. */
	times: Uint32Array;
	/** Typed characters in order, one code point per keystroke. */
	typed: string;
}

/** Per-session metadata + aggregates. */
export interface SessionSummary {
	id: string;
	timestamp: number;
	type: SessionType;
	durationMs: number;
	/** Raw, not smoothed. Smoothing lives in `progress/`. */
	wpm: number;
	errorRate: number;
	/**
	 * The prompt the user typed against. Stored from schema v2 on; absent on
	 * legacy rows, which is precisely why their `bigramAggregates` are the only
	 * evidence that survived — with no text there is no context to recover.
	 */
	text?: string;
	/**
	 * Raw keystroke log, from schema v2 on. The source every statistic is
	 * derived from; absent on legacy rows.
	 */
	stream?: KeystrokeStream;
	/**
	 * Derived from `stream` on read, not persisted — see `storage/service`.
	 * Legacy rows carry them as stored data instead, with their session-time
	 * thresholds frozen in.
	 */
	bigramAggregates: BigramAggregate[];
}

/**
 * What the `sessions` table actually holds. Aggregates are absent on rows
 * written from schema v2 on — they are re-derived from `stream` at read time,
 * so persisting them would be a second, staler source of the same truth.
 * Legacy rows are the mirror image: aggregates, no stream.
 */
export interface StoredSession extends Omit<SessionSummary, 'bigramAggregates'> {
	bigramAggregates?: BigramAggregate[];
}

export type Language = 'en' | 'fr';

/** Persistent user configuration. */
export interface UserSettings {
	/** Drives corpus selection — the corpus id is the language code itself. */
	language: Language;
	/** Optional second language mixed into draws. Bigram targeting stays primary. */
	secondaryLanguage?: Language;
	/** 0..100 — share of draws taken from `secondaryLanguage`. 0 = pure primary. */
	secondaryMix?: number;
	/** Per-user override of `DEFAULT_THRESHOLDS`. Advanced users only. */
	thresholds?: ClassificationThresholds;
	/** Words per passage. Overrides `DEFAULT_PASSAGE_WORDS`. */
	passageWords?: number;
	/**
	 * Whether a session opens with the pending-letter tint on. Only the opening
	 * state — the in-session toggle can turn it on or off regardless.
	 */
	colorizeBigramDifficulty?: boolean;
}

/**
 * Atomic keystroke unit — the in-memory shape, produced live by capture and
 * rebuilt from a stored {@link KeystrokeStream} on read. Only `position`,
 * `actual` and `timestamp` are stored; the rest are functions of the text.
 * `corrected` / `correctionDelay` are derived in post-processing.
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
