import {
	loadBuiltinCorpus,
	isBuiltinCorpusId,
	type BuiltinCorpusId,
	type FrequencyTable
} from '$lib/corpus';
import type { BigramClassification, DrillMode, UserSettings } from '$lib/core';
import { getProfile, DEFAULT_BIGRAM_DRILL_WORD_BUDGET } from '$lib/settings';
import { getBigramHistory, getRecentSessions } from '$lib/storage';
import { buildLivePriorityTargets, buildLiveUndertrained } from '$lib/progress';
import {
	consumePlannedSession,
	generateBigramDrillSequence,
	findGraduatedBigrams,
	DEFAULT_DRILL_TARGET_COUNT,
	selectAccuracyDrillMix,
	selectSpeedDrillMix
} from '$lib/practice';

const FALLBACK_CORPUS_ID: BuiltinCorpusId = 'en';
const RECENT_WINDOW = 20;
/** Cold-start fallback when live priority + undertrained are both empty. */
const SEED_TARGETS = ['th', 'he', 'in', 'er', 'an'] as const;

interface BigramDrillSessionInputs {
	text: string;
	targets: readonly string[];
	exposure: readonly string[];
	drillMode: DrillMode;
	baselineWPM: number;
}

/**
 * `routeMode` is the URL's own mode — each drill route passes its own constant so a stale
 * planned-session stash can't silently run a different treatment than the URL claims.
 */
export async function prepareDrillSession(routeMode: DrillMode): Promise<BigramDrillSessionInputs> {
	const planned = consumePlannedSession('bigram-drill');
	const profile = await getProfile();
	const wordBudget =
		planned?.config.wordBudget ??
		profile?.wordBudgets?.bigramDrill ??
		DEFAULT_BIGRAM_DRILL_WORD_BUDGET;
	const corpusId = resolveCorpusId(profile);
	const corpus = await loadBuiltinCorpus(corpusId);

	const fromPlan =
		planned?.config.bigramsTargeted && planned.config.bigramsTargeted.length > 0
			? { targets: planned.config.bigramsTargeted, mix: planned.drillMix }
			: null;
	const resolved = fromPlan ?? (await resolveDirectNavMix(routeMode, corpus.bigramFrequencies));

	const seq = generateBigramDrillSequence({
		targetBigrams: resolved.targets,
		corpus,
		options: { wordCount: wordBudget }
	});

	const baselineWPM = await getLatestBaselineWPM();

	return {
		text: seq.text,
		targets: resolved.targets,
		exposure: resolved.mix?.exposure ?? [],
		drillMode: routeMode,
		baselineWPM
	};
}

/** 0 when no diagnostic on file — shell treats that as "hide the ghost cursor." */
async function getLatestBaselineWPM(): Promise<number> {
	const recent = await getRecentSessions(RECENT_WINDOW);
	const report = recent.find((s) => s.type === 'diagnostic')?.diagnosticReport;
	return report?.baselineWPM ?? 0;
}

async function resolveDirectNavMix(
	mode: DrillMode,
	corpusFrequencies: FrequencyTable | undefined
): Promise<{
	targets: readonly string[];
	mix?: { priority: string[]; exposure: string[] };
}> {
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

function resolveCorpusId(profile: UserSettings | undefined): BuiltinCorpusId {
	const pickedId = profile?.corpusIds?.[0];
	return pickedId && isBuiltinCorpusId(pickedId) ? pickedId : FALLBACK_CORPUS_ID;
}
