import type { ClassificationThresholds } from './types';

// --- Classification thresholds ---

export const DEFAULT_SPEED_THRESHOLD_MS = 150;
export const DEFAULT_HIGH_ERROR_THRESHOLD = 0.05;

export const DEFAULT_THRESHOLDS: ClassificationThresholds = {
	speedMs: DEFAULT_SPEED_THRESHOLD_MS,
	errorRate: DEFAULT_HIGH_ERROR_THRESHOLD
};

/** Minimum occurrences before the four-way classification applies. Below: `unclassified`. */
export const MIN_OCCURRENCES_FOR_CLASSIFICATION = 10;

// --- Word budget defaults (user-tunable via profile) ---

export const DEFAULT_BIGRAM_DRILL_WORD_BUDGET = 25;
export const DEFAULT_REAL_TEXT_WORD_BUDGET = 25;
export const DEFAULT_DIAGNOSTIC_WORD_BUDGET = 100;

// --- Shared conversions / windows ---

/** 5 chars ≈ 1 word — translates word budgets into char targets. */
export const CHARS_PER_WORD = 5;
