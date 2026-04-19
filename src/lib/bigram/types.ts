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
