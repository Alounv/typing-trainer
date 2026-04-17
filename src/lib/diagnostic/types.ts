import type { KeystrokeEvent } from '../typing/types';
import type { BigramAggregate } from '../bigram/types';

/**
 * Full keystroke log for a diagnostic (spec §2.8). Persisted so tuning the
 * classification thresholds later can replay past diagnostics.
 */
export interface DiagnosticRawData {
	sessionId: string;
	events: KeystrokeEvent[];
}

/** Structured output of a diagnostic session (spec §7.3). */
export interface DiagnosticReport {
	sessionId: string;
	timestamp: number;
	/** Middle quartiles of session WPM (spec §3.3). */
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
		/** Fraction of corpus bigrams with ≥10 observations (spec §9). */
		coverageRatio: number;
		undertrained: string[];
	};
	aggregates: BigramAggregate[];
}

/** One entry in the diagnostic priority list. */
export interface PriorityBigram {
	bigram: string;
	/** badness × corpus frequency — higher means higher priority. */
	score: number;
	meanTime: number;
	errorRate: number;
}
