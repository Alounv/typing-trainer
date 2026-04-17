/**
 * "Graduated from rotation" filter (spec §5). Keeps the drill roster
 * honest: when a bigram has been classified `healthy` for the last
 * `CONSECUTIVE_HEALTHY_SESSIONS` sessions in which it appeared, it no
 * longer deserves drill time. The scheduler removes such bigrams from
 * `bigramsTargeted`, freeing slots for bottlenecks that still need
 * work.
 *
 * Why a helper (not inlined in the planner): the check is async — it
 * reads `getBigramHistory` from storage. Keeping the planner sync
 * makes it trivial to unit-test with fixture inputs. The dashboard
 * owns the wiring: call `findGraduatedBigrams` once, then feed the
 * Set into `planDailySessions`.
 */
import type { BigramAggregate } from '../bigram/types';

/**
 * How many consecutive session-aggregates must all read `healthy`
 * before a bigram leaves rotation. Spec §5 says "3 consecutive
 * healthy sessions".
 */
export const CONSECUTIVE_HEALTHY_SESSIONS = 3;

/** Injectable so tests can pass a pure fixture; prod passes `getBigramHistory`. */
export type BigramHistoryLookup = (bigram: string) => Promise<BigramAggregate[]>;

/**
 * Resolve to the subset of `candidates` that the planner should drop
 * from rotation. A bigram "graduates" when its most-recent N aggregates
 * (newest-first, as returned by `getBigramHistory`) are all classified
 * `healthy`. Bigrams with fewer than N occurrences stay in rotation
 * — under-observed ≠ safe.
 */
export async function findGraduatedBigrams(
	candidates: Iterable<string>,
	getHistory: BigramHistoryLookup
): Promise<Set<string>> {
	// Probe candidates in parallel — histories are independent Dexie
	// reads, and the dashboard blocks on this before first render.
	const unique = [...new Set(candidates)];
	const results = await Promise.all(
		unique.map(async (bigram) => ({
			bigram,
			graduated: isBigramGraduated(await getHistory(bigram))
		}))
	);
	return new Set(results.filter((r) => r.graduated).map((r) => r.bigram));
}

/**
 * Pure predicate exported for direct unit testing. `history` must be
 * ordered newest-first (matching `getBigramHistory`'s contract).
 */
export function isBigramGraduated(history: readonly BigramAggregate[]): boolean {
	if (history.length < CONSECUTIVE_HEALTHY_SESSIONS) return false;
	for (let i = 0; i < CONSECUTIVE_HEALTHY_SESSIONS; i++) {
		if (history[i].classification !== 'healthy') return false;
	}
	return true;
}
