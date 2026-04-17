/**
 * Spec §3.1. Each value maps to a distinct training prescription:
 * `healthy` (skip) · `fluency` (speed bursts) · `hasty` (slow reps) ·
 * `acquisition` (blocked slow drill).
 */
export type BigramClassification = 'healthy' | 'fluency' | 'hasty' | 'acquisition';

/**
 * One row per bigram per session, derived from {@link KeystrokeEvent}s at
 * session end. `classification` is a snapshot at session-time thresholds —
 * never recomputed, so historical records stay stable.
 */
export interface BigramAggregate {
	bigram: string;
	sessionId: string;
	occurrences: number;
	/** First inputs only — correction time is excluded (spec §2.2). */
	meanTime: number;
	stdTime: number;
	/** First-input errors; backspace does not erase. */
	errorCount: number;
	errorRate: number;
	classification: BigramClassification;
}
