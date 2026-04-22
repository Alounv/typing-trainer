import type { BigramClassification, DrillMode } from '../core';
import type { FrequencyTable } from '../corpus';
import { buildLivePriorityTargets, buildLiveUndertrained } from '../progress';
import { getBigramHistory, getRecentSessions } from '../storage';
import { RECENT_WINDOW } from '../core';
import { findGraduatedBigrams } from './graduation-filter';
import { DEFAULT_DRILL_TARGET_COUNT, selectAccuracyDrillMix, selectSpeedDrillMix } from './planner';

/** Cold-start fallback when live priority + undertrained are both empty. */
const SEED_TARGETS = ['th', 'he', 'in', 'er', 'an'] as const;

export interface DrillMix {
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
	const recent = await getRecentSessions(RECENT_WINDOW);

	// Class-scoped per mode so direct-nav matches the planner's own mode-scoped selection.
	const classes: readonly BigramClassification[] =
		mode === 'speed' ? ['fluency'] : ['hasty', 'acquisition'];
	const priorityTargets = buildLivePriorityTargets(
		recent,
		corpusFrequencies,
		undefined,
		undefined,
		classes
	);
	const undertrained = mode === 'accuracy' ? buildLiveUndertrained(recent, corpusFrequencies) : [];

	const priorityBigrams = priorityTargets.map((p) => p.bigram);
	const graduated = await findGraduatedBigrams(priorityBigrams, getBigramHistory);

	const mix =
		mode === 'speed'
			? selectSpeedDrillMix(priorityTargets, graduated, DEFAULT_DRILL_TARGET_COUNT)
			: selectAccuracyDrillMix(
					priorityTargets,
					undertrained,
					graduated,
					DEFAULT_DRILL_TARGET_COUNT
				);
	const targets = [...mix.priority, ...mix.exposure];
	return targets.length > 0 ? { targets, mix } : { targets: SEED_TARGETS };
}
