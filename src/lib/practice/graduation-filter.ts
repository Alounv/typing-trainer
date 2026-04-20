/**
 * "Graduated from rotation" filter. A bigram that's been `healthy` for the last
 * N sessions leaves the drill roster, freeing slots for bottlenecks. Lives outside
 * the planner because it's async (storage read); dashboard wires the two together.
 */
import type { BigramAggregate } from '../core';

/** Consecutive `healthy` sessions required before a bigram leaves rotation. */
export const CONSECUTIVE_HEALTHY_SESSIONS = 3;

/** Injectable so tests can pass a pure fixture; prod passes `getBigramHistory`. */
export type BigramHistoryLookup = (bigram: string) => Promise<BigramAggregate[]>;

/**
 * Subset of `candidates` to drop from rotation. A bigram graduates when its most
 * recent N aggregates are all `healthy`. Under-observed bigrams stay (≠ safe).
 */
export async function findGraduatedBigrams(
	candidates: Iterable<string>,
	getHistory: BigramHistoryLookup
): Promise<Set<string>> {
	// Parallel: independent Dexie reads, dashboard blocks on this before render.
	const unique = [...new Set(candidates)];
	const results = await Promise.all(
		unique.map(async (bigram) => ({
			bigram,
			graduated: isBigramGraduated(await getHistory(bigram))
		}))
	);
	return new Set(results.filter((r) => r.graduated).map((r) => r.bigram));
}

/** Pure predicate; `history` must be newest-first (matches `getBigramHistory`). */
export function isBigramGraduated(history: readonly BigramAggregate[]): boolean {
	if (history.length < CONSECUTIVE_HEALTHY_SESSIONS) return false;
	for (let i = 0; i < CONSECUTIVE_HEALTHY_SESSIONS; i++) {
		if (history[i].classification !== 'healthy') return false;
	}
	return true;
}
