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

/** Structured output of a diagnostic session. */
/**
 * Frozen-at-diagnostic-time snapshot. Pared down to the one value that can't
 * be re-derived from session history: the middle-quartiles baseline WPM that
 * drives the pacer. Counts, bottlenecks, priority targets, corpus fit — all
 * computable live from the diagnostic session's `bigramAggregates`.
 */
export interface DiagnosticReport {
	/** Middle quartiles of session WPM — drives the pacer. */
	baselineWPM: number;
}

/** One entry in the diagnostic priority list. */
export interface PriorityBigram {
	bigram: string;
	/** badness × corpus frequency — higher means higher priority. */
	score: number;
	meanTime: number;
	errorRate: number;
	/**
	 * Class this bigram falls into. `healthy` never appears (no need to drill).
	 * `unclassified` is allowed so the accuracy drill can pick up under-observed
	 * but error-prone bigrams; the planner routes hasty/acquisition/unclassified
	 * → accuracy-drill and fluency → speed-drill.
	 */
	classification: Exclude<BigramClassification, 'healthy'>;
}

export type SessionType = 'diagnostic' | 'bigram-drill' | 'real-text';

/** Per-session metadata + aggregates. */
export interface SessionSummary {
	id: string;
	timestamp: number;
	type: SessionType;
	durationMs: number;
	/** Raw, not smoothed. Smoothing lives in `progress/`. */
	wpm: number;
	errorRate: number;
	/** Set for `bigram-drill`, absent for `real-text` and `diagnostic`. */
	bigramsTargeted?: string[];
	/**
	 * Set for `bigram-drill` sessions from the treatment-rotation era forward.
	 * Absent on legacy drill sessions (pre-rotation) and on non-drill types,
	 * so consumers must treat `undefined` as "unknown / not applicable" rather
	 * than a default.
	 */
	drillMode?: DrillMode;
	bigramAggregates: BigramAggregate[];
	/**
	 * Populated only for `type === 'diagnostic'`. Computed at save time so the
	 * dashboard can pull priority targets without replaying the raw keystroke log.
	 */
	diagnosticReport?: DiagnosticReport;
}

export interface SessionConfig {
	type: SessionType;
	/**
	 * Total words the runner targets. Small on purpose — a drill/real-text mini-session
	 * is ≤1 min at 60 WPM, so abandoning loses at most a minute and every completion
	 * is a checkpoint.
	 */
	wordBudget: number;
	bigramsTargeted?: string[];
	/**
	 * Only meaningful when `type === 'bigram-drill'`. Drives pacer speed and
	 * on-screen instruction copy: accuracy mode targets `baselineWPM × 0.60`
	 * for hasty/acquisition bigrams (slow-down pressure), speed mode targets
	 * `targetWPM` (baseline × 1.17) for fluency bigrams (push-speed pressure).
	 * Absent on legacy sessions and non-drill types.
	 */
	drillMode?: DrillMode;
}

/**
 * Which treatment the drill session applies. `accuracy` = no speed pressure,
 * repetition on hasty/acquisition + undertrained targets. `speed` = pacer at
 * `targetWPM` over already-accurate fluency targets.
 */
export type DrillMode = 'accuracy' | 'speed';

export type Language = 'en' | 'fr';

/** Persistent user configuration. */
export interface UserSettings {
	/** Ordered by priority — first entry drives default corpus selection. */
	languages: Language[];
	/** One `CorpusConfig.id` per entry in `languages`. */
	corpusIds: string[];
	/** Per-user override of the defaults below. Advanced users only. */
	thresholds?: {
		speedMs: number;
		errorRate: number;
	};
	/** Per-user override of `DEFAULT_*_WORD_BUDGET`. Absent keys fall back to defaults. */
	wordBudgets?: {
		bigramDrill: number;
		realText: number;
		diagnostic: number;
	};
}

/** Atomic keystroke unit. `corrected` / `correctionDelay` are derived in post-processing. */
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
