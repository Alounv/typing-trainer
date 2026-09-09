import type { ClassificationThresholds } from './types';

const DEFAULT_SPEED_THRESHOLD_MS = 200;
export const DEFAULT_HIGH_ERROR_THRESHOLD = 0.05;

export const DEFAULT_THRESHOLDS: ClassificationThresholds = {
	speedMs: DEFAULT_SPEED_THRESHOLD_MS,
	errorRate: DEFAULT_HIGH_ERROR_THRESHOLD
};

/** Below this, a bigram is `unclassified` rather than given a worst-case class. */
export const MIN_OCCURRENCES_FOR_CLASSIFICATION = 10;

/** Occurrences, not sessions: the window spans whatever history it takes to find 20. */
export const BIGRAM_CLASSIFICATION_WINDOW = 20;

/** Short on purpose — abandoning costs under a minute at 60 WPM. */
export const DEFAULT_PASSAGE_WORDS = 25;

/**
 * Declared, not measured. A transition is only timed when both keystrokes were
 * correct, so every error occurrence stores `timing: null` and history can
 * never price one. Sized to a notice-backspace-retype cycle.
 */
export const ERROR_TIME_BUDGET_MS = 600;

/**
 * At 1.0 the priority score tracks raw frequency and severity stops mattering;
 * at 0 it collapses onto exotic punctuation. The square root is what lets time
 * loss have a say.
 */
export const PRIORITY_FREQUENCY_EXPONENT = 0.5;

/**
 * How many recent sessions count as "lately". Shared by the pacing baseline and
 * the milestone average because both are quoted on the summary page, where two
 * different windows read as one number contradicting itself.
 *
 * Twenty rather than a handful because a passage is short: 25 words is about
 * 19 seconds and 125 characters at 80 WPM, so a seven-session baseline averages
 * barely two minutes of typing and one awkward word moves it. Costs nothing at
 * cold start for pacing, which averages whatever history exists up to this cap.
 */
export const RECENT_WINDOW = 20;

/**
 * Separate from {@link DEFAULT_HIGH_ERROR_THRESHOLD} despite the equal value:
 * that one judges a bigram over a rolling window, this one judges a session
 * against how hard the typist pushed. They are free to diverge.
 */
export const PACING_TARGET_ERROR_RATE = 0.05;

/**
 * Without a dead zone this fires on half of all sessions — half of anyone's
 * sessions fall below their own mean by definition — and a verdict that common
 * stops being read.
 */
export const PACING_SLOW_MARGIN = 0.05;

/** 5 chars ≈ 1 word, the usual WPM convention. */
export const CHARS_PER_WORD = 5;
