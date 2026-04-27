import type { SessionSummary, BigramAggregate, BigramClassification } from '../support/core';
import { DEFAULT_HIGH_ERROR_THRESHOLD } from '../support/core';
import { countGraduations, WPM_ROLLING_WINDOW } from './metrics';

/** How far a metric must move from its rolling baseline to clear the "flat" band. */
const FLAT_BAND_PCT = 0.03;

type MetricVerdict = 'up' | 'down' | 'flat' | 'first';

interface MetricDelta {
	current: number;
	/** Average of the last `WPM_ROLLING_WINDOW` sessions before `current`. */
	rollingAvg: number | null;
	/** `null` when there's no baseline yet. */
	deltaPct: number | null;
	/** May be smaller than the full window for new users. */
	baselineSampleSize: number;
	verdict: MetricVerdict;
}

interface BigramDelta {
	drilled: number;
	graduatedToHealthy: number;
	regressed: number;
}

interface ErrorFloorInfo {
	current: number;
	threshold: number;
	below: boolean;
}

export interface SessionDelta {
	wpm: MetricDelta;
	errorRate: MetricDelta;
	bigrams: BigramDelta;
	errorFloor: ErrorFloorInfo;
	summarySentence: string;
}

/**
 * `history` may be unordered and may include `current` — we filter and sort
 * so a session never compares itself against itself.
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
	// Zero-baseline guard for early errorRate=0 streaks: 0→0 is flat, 0→positive
	// reads as "up" (correct for error rate; WPM=0 baselines are essentially impossible).
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
	// Most recent prior with bigram data — skipping empty priors gives a
	// more meaningful comparison.
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
	// `occurrences > 0` rather than finite meanTime so error-only bigrams still
	// count — the user did encounter them.
	return new Set(s.bigramAggregates.filter((a) => a.occurrences > 0).map((a) => a.bigram)).size;
}

/**
 * Deterministic interpretation line — kept testable. Any variation should
 * come from data, not random choice.
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
