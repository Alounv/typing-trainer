import type { DrillMode } from '../support/core';
import type { FrequencyTable } from '../corpus';
import { buildLivePriorityTargets, buildLiveUndertrained } from '../skill';
import { getBigramHistory, getRecentSessions } from '../support/storage';
import { findGraduatedBigrams } from './graduation-filter';
import {
	ACCURACY_CLASSES,
	DEFAULT_DRILL_TARGET_COUNT,
	SPEED_CLASSES,
	selectDrillMix
} from './planner';

/** Cold-start fallback when live priority + undertrained are both empty. */
const SEED_TARGETS = ['th', 'he', 'in', 'er', 'an'] as const;

interface DrillMix {
	targets: readonly string[];
	mix?: { priority: string[]; exposure: string[] };
}

/**
 * Direct-nav drill mix. Mirrors what the planner picks when a session is planned, so
 * hitting `/session/accuracy-drill` without a plan still gets a sensible target set.
 */
export async function resolveDrillMix(
	mode: DrillMode,
	corpusFrequencies: FrequencyTable | undefined
): Promise<DrillMix> {
	const stats = await getRecentSessions();

	// Class-scoped per mode so direct-nav matches the planner's own mode-scoped selection.
	const classes = mode === 'speed' ? SPEED_CLASSES : ACCURACY_CLASSES;
	const priorityTargets = buildLivePriorityTargets(
		stats,
		corpusFrequencies,
		undefined,
		undefined,
		classes
	);
	const exposurePool = mode === 'accuracy' ? buildLiveUndertrained(stats, corpusFrequencies) : [];

	const priorityBigrams = priorityTargets.map((p) => p.bigram);
	const graduated = await findGraduatedBigrams(priorityBigrams, getBigramHistory);

	const mix = selectDrillMix(
		priorityTargets,
		classes,
		DEFAULT_DRILL_TARGET_COUNT,
		graduated,
		exposurePool
	);
	const targets = [...mix.priority, ...mix.exposure];
	return targets.length > 0 ? { targets, mix } : { targets: SEED_TARGETS };
}
