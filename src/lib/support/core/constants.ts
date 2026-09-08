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

// --- Passage length (user-tunable via profile) ---

/**
 * Words per passage. Short on purpose: abandoning loses under a minute at
 * 60 WPM, and every completion is a checkpoint that feeds the ledger.
 */
export const DEFAULT_PASSAGE_WORDS = 25;

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

// --- Pacing bands ---

/**
 * The ~95-98% working band, as the two edges of the end-of-session verdict.
 *
 * Speed and accuracy are one curve: 100% accuracy means speed left unclaimed,
 * and errors past 5% cost more in corrections than the pace buys. Deliberately
 * separate from `ClassificationThresholds` — those judge a *bigram* over a
 * rolling window, these judge a *session* against how hard the typist pushed.
 */
export const PACING_CAUTIOUS_ERROR_RATE = 0.02;
export const PACING_TARGET_ERROR_RATE = 0.05;

/**
 * Sessions of the same type compared against for "am I slower than usual".
 * Same-type only: drill passages are bigram-dense and type slower than prose,
 * so a cross-type average would read every real-text session as a personal
 * best.
 */
export const PACING_COMPARISON_WINDOW = 10;

// --- Shared conversions / windows ---

/** 5 chars ≈ 1 word — translates word budgets into char targets. */
export const CHARS_PER_WORD = 5;
