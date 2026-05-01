export type {
	BigramClassification,
	BigramSample,
	BigramAggregate,
	ClassificationThresholds,
	DiagnosticReport,
	PriorityBigram,
	SessionType,
	SessionSummary,
	SessionConfig,
	DrillMode,
	Language,
	UserSettings,
	KeystrokeEvent,
	CaptureConfig
} from './types';
export {
	DEFAULT_SPEED_THRESHOLD_MS,
	DEFAULT_HIGH_ERROR_THRESHOLD,
	DEFAULT_THRESHOLDS,
	MIN_OCCURRENCES_FOR_CLASSIFICATION,
	BIGRAM_CLASSIFICATION_WINDOW,
	DEFAULT_BIGRAM_DRILL_WORD_BUDGET,
	DEFAULT_REAL_TEXT_WORD_BUDGET,
	DEFAULT_DIAGNOSTIC_WORD_BUDGET,
	DEFAULT_CYCLES_PER_DAY,
	DEFAULT_ACCURACY_DRILLS_PER_CYCLE,
	DEFAULT_SPEED_DRILLS_PER_CYCLE,
	CHARS_PER_WORD
} from './constants';
