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
	/** The runner may end earlier on graduation (spec §4.1). */
	durationMs: number;
	bigramsTargeted?: string[];
	pacerEnabled?: boolean;
}
