import type { ClassificationThresholds } from './types';

// --- Classification thresholds ---

export const DEFAULT_SPEED_THRESHOLD_MS = 200;
export const DEFAULT_HIGH_ERROR_THRESHOLD = 0.05;

export const DEFAULT_THRESHOLDS: ClassificationThresholds = {
	speedMs: DEFAULT_SPEED_THRESHOLD_MS,
	errorRate: DEFAULT_HIGH_ERROR_THRESHOLD
};

/** Minimum occurrences before the four-way classification applies. Below: `unclassified`. */
export const MIN_OCCURRENCES_FOR_CLASSIFICATION = 10;

/** Per-bigram rolling window over which classification metrics are pooled. Drives the
 *  classifier, the difficulty tint, the healthy-bigrams chart, and the sparkline view. */
export const BIGRAM_CLASSIFICATION_WINDOW = 20;

// --- Word budget defaults (user-tunable via profile) ---

export const DEFAULT_BIGRAM_DRILL_WORD_BUDGET = 25;
export const DEFAULT_REAL_TEXT_WORD_BUDGET = 25;
export const DEFAULT_DIAGNOSTIC_WORD_BUDGET = 100;

// --- Plan structure defaults (user-tunable via profile) ---

export const DEFAULT_CYCLES_PER_DAY = 2;
export const DEFAULT_ACCURACY_DRILLS_PER_CYCLE = 2;
export const DEFAULT_SPEED_DRILLS_PER_CYCLE = 2;

// --- Priority scoring ---

/**
 * Time charged to a single error, in ms.
 *
 * Errors cannot be priced from history: `extractBigramAggregates` only records a
 * transition time when *both* keystrokes were correct, so every error occurrence
 * stores `timing: null`. The correction time is computed during post-processing
 * (`annotateFirstInputs`) but never persisted, so this has to be declared rather
 * than measured. Sized to a plausible notice-backspace-retype cycle.
 *
 * Changing it barely reorders the priority list — corpus frequency dominates the
 * product — but it does set how much of a bigram's reported loss is attributed to
 * errors rather than slowness, which is what the table column shows.
 */
export const ERROR_TIME_BUDGET_MS = 600;

/**
 * Exponent applied to corpus frequency in the priority score.
 *
 * At 1.0 the product tracks raw frequency almost perfectly and severity stops
 * mattering — the commonest bigrams top the list however well they are typed.
 * The square root lets time loss have a real say without the ranking collapsing
 * onto rare pairs. At 0 it degenerates entirely into exotic punctuation.
 */
export const PRIORITY_FREQUENCY_EXPONENT = 0.5;

// --- Shared conversions / windows ---

/** 5 chars ≈ 1 word — translates word budgets into char targets. */
export const CHARS_PER_WORD = 5;
