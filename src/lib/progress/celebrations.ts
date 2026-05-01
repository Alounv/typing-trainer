import type { BigramClassification, SessionSummary } from '../support/core';
import { summarizeBigrams } from '$lib/skill';
import { buildWpmSeries } from './metrics';

type MovementDirection = 'up' | 'down';

type RankedClass = Exclude<BigramClassification, 'unclassified'>;

export interface MovementEvent {
	bigram: string;
	/** `null` when this bigram wasn't in the prior session. */
	from: RankedClass | null;
	to: RankedClass;
	direction: MovementDirection;
}

interface MovementGroup {
	from: MovementEvent['from'];
	to: MovementEvent['to'];
	direction: MovementDirection;
	bigrams: string[];
}

/** Bucket movement events by `(from, to)` so the UI can render one row per transition. */
export function groupMovements(events: readonly MovementEvent[]): MovementGroup[] {
	const byKey = new Map<string, MovementGroup>();
	for (const e of events) {
		const key = `${e.from}→${e.to}`;
		let group = byKey.get(key);
		if (!group) {
			group = { from: e.from, to: e.to, direction: e.direction, bigrams: [] };
			byKey.set(key, group);
		}
		group.bigrams.push(e.bigram);
	}
	return [...byKey.values()];
}

/**
 * Class hierarchy. hasty (fast but errors) sits below fluency (accurate but
 * slow) because cleaning up errors is the axis to optimise first.
 */
const RANK: Record<RankedClass, number> = {
	acquisition: 0,
	hasty: 1,
	fluency: 2,
	healthy: 3
};

/**
 * Compare rolling-window classifications before vs. after the named session.
 * "Before" excludes the current session entirely; "after" includes it. This
 * matches the classification displayed in the bigram table, so a movement
 * shown here means the user's overall standing on that bigram actually moved
 * — not just a single session of bad luck.
 *
 * First-appearance bigrams only emit when they land in `healthy`;
 * `unclassified` on either side is skipped as noise.
 */
export function detectWindowedMovements(
	allSessions: readonly SessionSummary[],
	currentSessionId: string
): MovementEvent[] {
	const before = allSessions.filter((s) => s.id !== currentSessionId);
	const beforeRows = summarizeBigrams(before);
	const afterRows = summarizeBigrams(allSessions);
	const prevClass = new Map<string, BigramClassification>();
	for (const r of beforeRows) prevClass.set(r.bigram, r.classification);

	const events: MovementEvent[] = [];
	for (const { bigram, classification: to } of afterRows) {
		const from = prevClass.get(bigram) ?? null;
		if (to === 'unclassified' || from === 'unclassified') continue;
		if (from === to) continue;

		if (from === null) {
			if (to === 'healthy') events.push({ bigram, from, to, direction: 'up' });
			continue;
		}

		const direction: MovementDirection = RANK[to] > RANK[from] ? 'up' : 'down';
		events.push({ bigram, from, to, direction });
	}

	// Improvements first; within a group, larger jumps first.
	events.sort((a, b) => {
		if (a.direction !== b.direction) return a.direction === 'up' ? -1 : 1;
		const aJump = a.from === null ? RANK[a.to] : Math.abs(RANK[a.to] - RANK[a.from]);
		const bJump = b.from === null ? RANK[b.to] : Math.abs(RANK[b.to] - RANK[b.from]);
		return bJump - aJump;
	});
	return events;
}

/**
 * Round-number WPM milestones worth calling out. 50 is deliberately missing —
 * it tends to coincide with first-diagnostic baselines for touch typists and
 * would fire without being earned. The jumps of 10 above 60 reflect how
 * meaningfully harder each step gets.
 */
const WPM_MILESTONES = [60, 70, 80, 90, 100] as const;
type WpmMilestone = (typeof WPM_MILESTONES)[number];

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
