import type { BigramClassification } from '../bigram/types';

/** A bigram moved classification between diagnostics — the most noise-resistant progress signal. */
export interface GraduationEvent {
	bigram: string;
	from: BigramClassification;
	to: BigramClassification;
	sessionId: string;
	timestamp: number;
}

/** Per-session distribution across the four classifications — enables today-vs-past diffs. */
export interface ClassificationSnapshot {
	timestamp: number;
	healthy: number;
	fluency: number;
	hasty: number;
	acquisition: number;
	total: number;
}

/** Rolling minimum error rate over last 10 sessions; moves only on genuine improvement. */
export interface ErrorFloorHistory {
	values: { sessionId: string; floor: number }[];
	current: number;
	/** Change in floor; positive = worse. */
	delta7d: number;
	delta30d: number;
}

/**
 * Slowest-Decile Mean: avg transition time of the bottom 10% of bigrams.
 * Leading indicator — drops 2–3 weeks before WPM catches up.
 */
export interface SDMHistory {
	values: { sessionId: string; sdm: number }[];
	current: number;
	/** Change in ms; negative = faster = better. */
	delta7d: number;
	delta30d: number;
}

/** Per-session WPM with rolling stats pre-computed at write time. */
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

/** Per-diagnostic "what got better / what's stubborn" report. */
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

/** The singleton row backing every long-term progress view. */
export interface ProgressStore {
	graduationHistory: GraduationEvent[];
	classificationSnapshots: ClassificationSnapshot[];
	wpmHistory: WPMHistoryEntry[];
	sdmHistory: SDMHistory;
	errorFloorHistory: ErrorFloorHistory;
	diagnosticReports: DiagnosticProgressReport[];
}
