import type { BigramAggregate } from '../bigram/types';

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
