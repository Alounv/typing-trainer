export type {
	BigramClassification,
	BigramSample,
	BigramAggregate,
	ClassificationThresholds,
	PriorityBigram,
	SessionType,
	SessionSummary,
	StoredSession,
	KeystrokeStream,
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
	DEFAULT_PASSAGE_WORDS,
	ERROR_TIME_BUDGET_MS,
	PRIORITY_FREQUENCY_EXPONENT,
	PACING_TARGET_ERROR_RATE,
	PACING_SLOW_MARGIN,
	PACING_COMPARISON_WINDOW,
	CHARS_PER_WORD
} from './constants';
