import type { BigramAggregate, BigramClassification } from '../bigram';
import type { SessionSummary } from '../session';
import { buildWpmSeries } from './metrics';

/**
 * Celebration detection (Phase 8.3).
 *
 * Pure functions that compare the previous session's per-bigram classifications
 * against the current session's and emit the "threshold crossings worth
 * celebrating" — not effort, only structural change. Consumed by the summary
 * page as an inline callout list.
 *
 * Spec §10.4 originally called for two tiers: escaped-acquisition ("no longer
 * an acquisition gap") and full graduation ("graduated to healthy"). We also
 * emit a third tier — hasty → fluency — because trading errors for a slower
 * but clean execution is the canonical "clean up your typing" move and the
 * user sees no feedback for it otherwise.
 *
 * A bigram that wasn't present in the previous session is treated as "new";
 * landing in `healthy` on first appearance still counts as a graduation (the
 * user converted a blank row into a solved one). Landing in a non-healthy
 * class on first appearance emits nothing — there's no prior state to improve
 * from.
 */

/**
 * Ordered best → worst for comparisons. `unclassified` sits between acquisition
 * and hasty only in the sense of "we don't know yet"; we treat transitions
 * involving it conservatively (no celebration) to avoid false positives from
 * sparse data.
 */
const CLASS_RANK: Record<BigramClassification, number> = {
	healthy: 0,
	fluency: 1,
	hasty: 2,
	acquisition: 3,
	unclassified: 4
};

export type GraduationTier =
	| 'healthy' // anything (non-healthy) → healthy
	| 'escaped-acquisition' // acquisition → hasty | fluency
	| 'cleaned-up'; // hasty → fluency

export interface GraduationEvent {
	bigram: string;
	tier: GraduationTier;
	/** Previous classification, or `null` when this bigram wasn't in the prior session. */
	from: BigramClassification | null;
	to: BigramClassification;
}

/**
 * Detect graduation events between two per-session bigram snapshots.
 *
 * `prev` may be `null` when there's no prior session with bigram data yet; in
 * that case we only emit `healthy`-tier events for bigrams that appeared
 * already classified as healthy (treating "first appearance in healthy" as a
 * graduation from a blank baseline).
 *
 * Results are ordered by tier (`healthy` first, then `escaped-acquisition`,
 * then `cleaned-up`) so the UI can render the most celebratory line first.
 */
export function detectGraduations(
	prev: readonly BigramAggregate[] | null,
	current: readonly BigramAggregate[]
): GraduationEvent[] {
	const prevClass = new Map<string, BigramClassification>();
	if (prev) {
		for (const a of prev) prevClass.set(a.bigram, a.classification);
	}

	const events: GraduationEvent[] = [];
	for (const agg of current) {
		const from = prevClass.get(agg.bigram) ?? null;
		const to = agg.classification;
		// Skip unclassified transitions in either direction — too noisy.
		if (to === 'unclassified' || from === 'unclassified') continue;

		// Full graduation: ended in healthy, wasn't already healthy.
		if (to === 'healthy' && from !== 'healthy') {
			events.push({ bigram: agg.bigram, tier: 'healthy', from, to });
			continue;
		}
		if (from === null) continue; // first appearance but not healthy — nothing to say yet

		// Escaped acquisition: was acquisition, now hasty or fluency.
		if (from === 'acquisition' && (to === 'hasty' || to === 'fluency')) {
			events.push({ bigram: agg.bigram, tier: 'escaped-acquisition', from, to });
			continue;
		}

		// Cleaned up: traded errors for clean (hasty → fluency). Same rank-wise
		// improvement in the "error-free" axis, which is the axis the user
		// should be optimising first.
		if (from === 'hasty' && to === 'fluency') {
			events.push({ bigram: agg.bigram, tier: 'cleaned-up', from, to });
			continue;
		}
	}

	// Tier order: the most celebratory tier renders first.
	const TIER_ORDER: GraduationTier[] = ['healthy', 'escaped-acquisition', 'cleaned-up'];
	events.sort((a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier));
	return events;
}

/** True when a classification transition is strictly an improvement (lower rank).
 * Exported for potential future use by regression detection (§10.5); not used
 * by the graduation tiers above because they're opinionated beyond pure rank. */
export function isImprovement(from: BigramClassification, to: BigramClassification): boolean {
	if (from === 'unclassified' || to === 'unclassified') return false;
	return CLASS_RANK[to] < CLASS_RANK[from];
}

/**
 * Round-number WPM milestones worth calling out. 50 is deliberately missing —
 * it tends to coincide with first-diagnostic baselines for touch typists and
 * would fire without being earned. The jumps of 10 above 60 reflect how
 * meaningfully harder each step gets.
 */
export const WPM_MILESTONES = [60, 70, 80, 90, 100] as const;
export type WpmMilestone = (typeof WPM_MILESTONES)[number];

export interface MilestoneEvent {
	/** The highest threshold newly crossed this session. */
	threshold: WpmMilestone;
	/** Current 7-session rolling average at the moment the milestone fired. */
	rollingWpm: number;
}

/**
 * Detect whether the 7-session rolling average crossed a new WPM milestone
 * between the previous session and `current`.
 *
 * We fire on the **smoothed** series rather than raw WPM so a single lucky
 * session can't trigger a milestone the user can't sustain. Returns the
 * *highest* threshold crossed in a single step — if a user jumps from 58 to
 * 78 smoothed in one step (e.g., after a long layoff), we celebrate 70, not
 * both 60 and 70.
 *
 * Returns `null` when:
 * - `current` has no rolling average yet (fewer than 7 sessions including it),
 * - the prior rolling average was already ≥ the current rolling average,
 * - no new threshold was crossed.
 */
export function detectMilestone(
	current: SessionSummary,
	history: readonly SessionSummary[]
): MilestoneEvent | null {
	// Ensure `current` is in the series so the last point reflects it. buildWpmSeries
	// de-dupes by timestamp-sort, not id, so including a duplicate would skew the
	// rolling mean — filter first.
	const merged = [...history.filter((s) => s.id !== current.id), current];
	const series = buildWpmSeries(merged);
	if (series.length === 0) return null;

	const last = series[series.length - 1];
	const prev = series[series.length - 2];
	if (last.rolling === null) return null; // window not yet full
	if (!prev || prev.rolling === null) return null; // no comparable baseline

	// Find the highest threshold newly crossed. "Newly" = prev.rolling was
	// below it, last.rolling is at or above it. Strictly-less on the prior side
	// avoids re-firing when the series drifts around the threshold.
	let crossed: WpmMilestone | null = null;
	for (const t of WPM_MILESTONES) {
		if (prev.rolling < t && last.rolling >= t) {
			crossed = t;
		}
	}
	if (crossed === null) return null;
	return { threshold: crossed, rollingWpm: last.rolling };
}
