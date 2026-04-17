import type { BigramAggregate } from '../bigram/types';

export type SessionType = 'diagnostic' | 'bigram-drill' | 'real-text';

/**
 * Per-session metadata + aggregates (spec §2.7). Raw keystroke events live
 * in `diagnosticRawData` and only for diagnostic sessions.
 */
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
}

export interface SessionConfig {
	type: SessionType;
	/**
	 * Total words the runner targets. The generator pre-sizes text to
	 * roughly this many words; the runner may end earlier on graduation
	 * (spec §4.1). Kept intentionally small for drill/real-text — a
	 * session is a mini-workout (≤1 min at 60 WPM) so abandoning loses
	 * at most a minute of data and every completion is a checkpoint.
	 */
	wordBudget: number;
	bigramsTargeted?: string[];
	pacerEnabled?: boolean;
}
