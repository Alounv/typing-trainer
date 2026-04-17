import type { BigramClassification } from '../bigram/types';

/**
 * A bigram moved classification between diagnostics (spec §10.2). The most
 * trustworthy progress signal — immune to session noise.
 */
export interface GraduationEvent {
	bigram: string;
	from: BigramClassification;
	to: BigramClassification;
	sessionId: string;
	timestamp: number;
}

/**
 * Distribution of active bigrams across the four classifications. Recorded
 * per session so we can diff today vs. 4 weeks ago (spec §10.6).
 */
export interface ClassificationSnapshot {
	timestamp: number;
	healthy: number;
	fluency: number;
	hasty: number;
	acquisition: number;
	total: number;
}

/**
 * Rolling minimum error rate over the last 10 sessions (spec §10.2). Only
 * moves on genuine improvement; immune to noisy high-error sessions.
 */
export interface ErrorFloorHistory {
	values: { sessionId: string; floor: number }[];
	current: number;
	/** Change in floor; positive = worse. */
	delta7d: number;
	delta30d: number;
}

/**
 * Slowest-Decile Mean — average transition time of the bottom 10% of bigrams
 * (spec §10.2). Leading indicator: drops 2–3 weeks before WPM catches up.
 */
export interface SDMHistory {
	values: { sessionId: string; sdm: number }[];
	current: number;
	/** Change in ms; negative = faster = better. */
	delta7d: number;
	delta30d: number;
}

/** Per-session WPM with rolling stats pre-computed at write time (spec §10.7). */
export interface WPMHistoryEntry {
	sessionId: string;
	/** Raw — never displayed alone. */
	raw: number;
	/** 7-session rolling average. */
	smoothed: number;
	/** Rolling min / max over last 10 sessions. */
	floor: number;
	ceiling: number;
}

/** Per-diagnostic "what got better / what's stubborn" report (spec §10.7). */
export interface DiagnosticProgressReport {
	diagnosticSessionId: string;
	timestamp: number;
	bigramsGraduated: GraduationEvent[];
	sdmDelta: number;
	/** Smoothed WPM delta since the previous diagnostic. */
	wpmDelta: number;
	bigramsImproved: string[];
	priorityBigrams: string[];
}

/** The singleton row backing every long-term progress view (spec §10.7). */
export interface ProgressStore {
	graduationHistory: GraduationEvent[];
	classificationSnapshots: ClassificationSnapshot[];
	wpmHistory: WPMHistoryEntry[];
	sdmHistory: SDMHistory;
	errorFloorHistory: ErrorFloorHistory;
	diagnosticReports: DiagnosticProgressReport[];
}
