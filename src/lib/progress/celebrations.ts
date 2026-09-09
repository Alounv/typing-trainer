import type {
	BigramClassification,
	ClassificationThresholds,
	SessionSummary
} from '../support/core';
import { summarizeBigrams, type BigramSummary } from '$lib/skill';
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
	/**
	 * The windowed summary *including* the current session — the same rows the
	 * bigram table renders. Taken as an argument rather than recomputed: the
	 * caller already has it, and only `bigram` and `classification` are read
	 * here, neither of which depends on how the caller weighted it.
	 */
	after: readonly BigramSummary[],
	allSessions: readonly SessionSummary[],
	currentSessionId: string,
	thresholds: ClassificationThresholds
): MovementEvent[] {
	const before = allSessions.filter((s) => s.id !== currentSessionId);
	const beforeRows = summarizeBigrams(before, undefined, thresholds);
	const prevClass = new Map<string, BigramClassification>();
	for (const r of beforeRows) prevClass.set(r.bigram, r.classification);

	const events: MovementEvent[] = [];
	for (const { bigram, classification: to } of after) {
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
 * Fires on the smoothed series, not raw WPM, so one lucky session cannot earn a
 * badge the typist cannot sustain — which also means nothing fires before the
 * seventh session. Awards the highest threshold reached in a single step: 58 to
 * 78 after a layoff earns 70, not both 60 and 70.
 */
export function detectMilestone(
	current: SessionSummary,
	history: readonly SessionSummary[]
): MilestoneEvent | null {
	// `history` often already contains `current`; including it twice would skew
	// the rolling mean, since the series de-dupes by timestamp order and not id.
	const merged = [...history.filter((s) => s.id !== current.id), current];
	const series = buildWpmSeries(merged);

	// The series is chronological, so its last point is the newest session on
	// file — which is `current` only when the summary being viewed is the most
	// recent one. Locate `current`, or an old summary reports a badge a later
	// session earned.
	const at = series.findIndex((p) => p.sessionId === current.id);
	if (at < 0) return null;

	const here = series[at];
	if (here.rolling === null) return null; // window not yet full

	// "Reached for the first time", compared against every earlier point rather
	// than just the one before. Comparing with the predecessor alone awards the
	// badge again every time the average drifts back down across the line and
	// returns, and nothing records that it was already given.
	const reachedBefore = (t: number) =>
		series.slice(0, at).some((p) => p.rolling !== null && p.rolling >= t);

	let crossed: WpmMilestone | null = null;
	for (const t of WPM_MILESTONES) {
		if (here.rolling >= t && !reachedBefore(t)) crossed = t;
	}
	if (crossed === null) return null;
	return { threshold: crossed, rollingWpm: here.rolling };
}
