/**
 * Cross-lib domain types.
 *
 * These shapes are referenced by multiple runtime libs (session, practice,
 * progress, settings, storage, bigram, diagnostic). Keeping them in each
 * originating lib was creating type-level back-edges — every lib that
 * needed `SessionSummary` / `BigramAggregate` re-imported from a lib that
 * transitively depended on it.
 *
 * Homing the types here makes `core` a true DAG leaf — no runtime, no
 * imports from other `$lib/*` modules — and lets the value-level graph
 * stay strictly one-way.
 */

// ──────────────────────────────────────────────────────────────
// Bigram
// ──────────────────────────────────────────────────────────────

/**
 * Maps to training prescription: `healthy` (skip) · `fluency` (speed bursts) ·
 * `hasty` (slow reps) · `acquisition` (blocked slow drill) · `unclassified` (undertrained).
 */
export type BigramClassification = 'healthy' | 'fluency' | 'hasty' | 'acquisition' | 'unclassified';

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

// ──────────────────────────────────────────────────────────────
// Diagnostic
// ──────────────────────────────────────────────────────────────

/** Structured output of a diagnostic session. */
export interface DiagnosticReport {
	sessionId: string;
	timestamp: number;
	/** Middle quartiles of session WPM. */
	baselineWPM: number;
	/** `baselineWPM × TARGET_WPM_MULTIPLIER`. */
	targetWPM: number;
	counts: {
		healthy: number;
		fluency: number;
		hasty: number;
		acquisition: number;
	};
	/** Top-5 per non-healthy class, ranked by badness. */
	topBottlenecks: {
		fluency: string[];
		hasty: string[];
		acquisition: string[];
	};
	priorityTargets: PriorityBigram[];
	corpusFit: {
		/** Fraction of corpus bigrams with ≥10 observations. */
		coverageRatio: number;
		undertrained: string[];
	};
}

/** One entry in the diagnostic priority list. */
export interface PriorityBigram {
	bigram: string;
	/** badness × corpus frequency — higher means higher priority. */
	score: number;
	meanTime: number;
	errorRate: number;
	/**
	 * Non-healthy class this bigram falls into. `unclassified` and `healthy`
	 * never appear in the priority list, so the type excludes them — this lets
	 * the drill planner route hasty/acquisition → accuracy-drill and
	 * fluency → speed-drill without re-deriving the class at plan time.
	 */
	classification: Exclude<BigramClassification, 'healthy' | 'unclassified'>;
}

// ──────────────────────────────────────────────────────────────
// Session
// ──────────────────────────────────────────────────────────────

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
}

// ──────────────────────────────────────────────────────────────
// Settings
// ──────────────────────────────────────────────────────────────

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
