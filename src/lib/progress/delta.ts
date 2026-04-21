import type { SessionSummary, BigramAggregate, BigramClassification } from '../core';
import { DEFAULT_HIGH_ERROR_THRESHOLD } from '../bigram';
import { countGraduations, WPM_ROLLING_WINDOW } from './metrics';

/**
 * Session delta — the post-session "how did this compare?" view model.
 *
 * Pure: given the current session and its history, produce a display-ready
 * object. No I/O, no classifier calls beyond what's already baked into the
 * session summaries. This is 8.1 only — no "bad session" attribution (8.2),
 * no celebration copy (8.3/8.4/8.5). Those layers plug in later without
 * changing the shape below.
 */

/** How far a metric must move from its rolling baseline to clear the "flat" band. */
const FLAT_BAND_PCT = 0.03;

type MetricVerdict = 'up' | 'down' | 'flat' | 'first';

interface MetricDelta {
	current: number;
	/** Average of the last `WPM_ROLLING_WINDOW` sessions BEFORE `current`. */
	rollingAvg: number | null;
	/** `(current - rollingAvg) / rollingAvg`. `null` when there's no baseline yet. */
	deltaPct: number | null;
	/** Size of the window `rollingAvg` was computed over (may be < full window for new users). */
	baselineSampleSize: number;
	verdict: MetricVerdict;
}

interface BigramDelta {
	/**
	 * Number of distinct bigrams this session drilled / encountered. For
	 * `bigram-drill` sessions we take `bigramsTargeted`; for other types we
	 * count distinct bigrams with a clean timing sample (so the card shows
	 * "you touched 42 bigrams" rather than 0).
	 */
	drilled: number;
	/** Bigrams that were non-healthy in the previous session and are healthy now. */
	graduatedToHealthy: number;
	/** Bigrams that were healthy in the previous session and have fallen out. */
	regressed: number;
}

interface ErrorFloorInfo {
	current: number;
	threshold: number;
	/** True when `current` is at or below the spec's high-error threshold. */
	below: boolean;
}

export interface SessionDelta {
	wpm: MetricDelta;
	errorRate: MetricDelta;
	bigrams: BigramDelta;
	errorFloor: ErrorFloorInfo;
	/** One-line neutral interpretation — deterministic, built from the parts above. */
	summarySentence: string;
}

/**
 * Main entry point.
 *
 * `history` must include every session ever recorded (ordered or not — we
 * sort internally). `current` is included if it appears in `history`; we
 * filter it out before building the baseline so a session never compares
 * itself against itself.
 */
export function computeSessionDelta(
	current: SessionSummary,
	history: readonly SessionSummary[]
): SessionDelta {
	const prior = [...history]
		.filter((s) => s.id !== current.id)
		.sort((a, b) => a.timestamp - b.timestamp);

	const wpm = buildMetricDelta(
		current.wpm,
		prior.map((s) => s.wpm)
	);
	const errorRate = buildMetricDelta(
		current.errorRate,
		prior.map((s) => s.errorRate)
	);
	const bigrams = buildBigramDelta(current, prior);
	const errorFloor: ErrorFloorInfo = {
		current: current.errorRate,
		threshold: DEFAULT_HIGH_ERROR_THRESHOLD,
		below: current.errorRate <= DEFAULT_HIGH_ERROR_THRESHOLD
	};

	return {
		wpm,
		errorRate,
		bigrams,
		errorFloor,
		summarySentence: buildSummarySentence({ wpm, errorRate, bigrams, errorFloor })
	};
}

function buildMetricDelta(current: number, priorValues: readonly number[]): MetricDelta {
	// Take the most recent `WPM_ROLLING_WINDOW` values; `priorValues` is oldest-first.
	const windowed = priorValues.slice(-WPM_ROLLING_WINDOW);
	if (windowed.length === 0) {
		return {
			current,
			rollingAvg: null,
			deltaPct: null,
			baselineSampleSize: 0,
			verdict: 'first'
		};
	}
	const rollingAvg = windowed.reduce((a, b) => a + b, 0) / windowed.length;
	// Guard a zero-baseline divide — can happen early on with errorRate=0 streaks.
	// When the baseline is zero and current is also zero, there's no movement;
	// when baseline is zero and current is positive, treat as an "up" (for error
	// rate this reads as "you got worse" — correct — and for WPM a 0 baseline
	// is essentially impossible, so the edge case is just defensive).
	const deltaPct =
		rollingAvg === 0
			? current === 0
				? 0
				: Number.POSITIVE_INFINITY
			: (current - rollingAvg) / rollingAvg;

	let verdict: MetricVerdict;
	if (!Number.isFinite(deltaPct)) {
		verdict = 'up';
	} else if (Math.abs(deltaPct) < FLAT_BAND_PCT) {
		verdict = 'flat';
	} else {
		verdict = deltaPct > 0 ? 'up' : 'down';
	}

	return {
		current,
		rollingAvg,
		deltaPct: Number.isFinite(deltaPct) ? deltaPct : null,
		baselineSampleSize: windowed.length,
		verdict
	};
}

function buildBigramDelta(current: SessionSummary, prior: readonly SessionSummary[]): BigramDelta {
	// "Previous session" = the most recent prior session that actually carried
	// bigram data. Skipping empty/diagnostic-only priors gives a more meaningful
	// comparison than "the one right before this one, even if it was empty".
	const prev = [...prior].reverse().find((s) => s.bigramAggregates.length > 0);
	const graduatedToHealthy = prev
		? countGraduations(prev.bigramAggregates, current.bigramAggregates)
		: 0;
	const regressed = prev ? countRegressions(prev.bigramAggregates, current.bigramAggregates) : 0;

	return {
		drilled: countDrilled(current),
		graduatedToHealthy,
		regressed
	};
}

/** Mirror of `countGraduations` but for the "was healthy, no longer is" direction. */
function countRegressions(
	before: readonly BigramAggregate[],
	after: readonly BigramAggregate[]
): number {
	const beforeClass = new Map<string, BigramClassification>();
	for (const a of before) beforeClass.set(a.bigram, a.classification);
	let regressed = 0;
	for (const a of after) {
		if (a.classification === 'healthy') continue;
		if (beforeClass.get(a.bigram) === 'healthy') regressed++;
	}
	return regressed;
}

function countDrilled(s: SessionSummary): number {
	if (s.type === 'bigram-drill' && s.bigramsTargeted?.length) {
		return new Set(s.bigramsTargeted).size;
	}
	// Diagnostic / real-text: count distinct bigrams we observed cleanly enough
	// to have a timing sample. Using `occurrences > 0` rather than a finite
	// meanTime so error-only bigrams still count — the user did encounter them.
	return new Set(s.bigramAggregates.filter((a) => a.occurrences > 0).map((a) => a.bigram)).size;
}

/**
 * Deterministic interpretation line. Factual, not coachy — "68 WPM · 4% above
 * your 7-session average · 2 bigrams graduated to healthy." Keep this testable;
 * if we ever add variation, it should come from data, not random choice.
 */
function buildSummarySentence(parts: {
	wpm: MetricDelta;
	errorRate: MetricDelta;
	bigrams: BigramDelta;
	errorFloor: ErrorFloorInfo;
}): string {
	const pieces: string[] = [`${parts.wpm.current.toFixed(1)} WPM`];

	if (parts.wpm.verdict === 'first') {
		pieces.push('your first recorded session');
	} else if (parts.wpm.verdict === 'flat') {
		pieces.push(`even with your ${parts.wpm.baselineSampleSize}-session average`);
	} else {
		const pct = Math.abs((parts.wpm.deltaPct ?? 0) * 100).toFixed(0);
		const dir = parts.wpm.verdict === 'up' ? 'above' : 'below';
		pieces.push(`${pct}% ${dir} your ${parts.wpm.baselineSampleSize}-session average`);
	}

	const errPct = (parts.errorFloor.current * 100).toFixed(1);
	pieces.push(
		parts.errorFloor.below
			? `${errPct}% errors — clean`
			: `${errPct}% errors — above the ${(parts.errorFloor.threshold * 100).toFixed(0)}% floor`
	);

	if (parts.bigrams.graduatedToHealthy > 0) {
		const n = parts.bigrams.graduatedToHealthy;
		pieces.push(`${n} bigram${n === 1 ? '' : 's'} graduated to healthy`);
	}

	return pieces.join(' · ') + '.';
}
