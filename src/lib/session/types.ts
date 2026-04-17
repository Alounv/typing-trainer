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
	 * (spec §4.1).
	 */
	wordBudget: number;
	/**
	 * How many equal-ish chunks the budget is split into. 1 = no
	 * between-rounds transitions (diagnostic uses this — it's a
	 * measurement, not a workout). Drills and real-text default to 4.
	 */
	roundCount: number;
	bigramsTargeted?: string[];
	pacerEnabled?: boolean;
}
