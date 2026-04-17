import type { BigramAggregate } from '../bigram/types';

export type SessionType = 'diagnostic' | 'bigram-drill' | 'real-text';

/** Per-session metadata + aggregates. Raw events live in `diagnosticRawData` (diagnostics only). */
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
	 * Total words the runner targets. Small on purpose — a drill/real-text mini-session
	 * is ≤1 min at 60 WPM, so abandoning loses at most a minute and every completion
	 * is a checkpoint. May end earlier on graduation.
	 */
	wordBudget: number;
	bigramsTargeted?: string[];
	pacerEnabled?: boolean;
}
