import { loadBuiltinCorpus, generateText } from '$lib/corpus';
import { DEFAULT_BIGRAM_DRILL_WORD_BUDGET } from '$lib/support/core';
import type { DrillMode } from '$lib/support/core';
import { getProfile } from '$lib/settings';
import { getRecentSessions } from '$lib/support/storage';
import { consumePlannedSession, resolveDrillMix } from '$lib/plan';

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
	const corpus = await loadBuiltinCorpus(profile?.language ?? 'en');

	const fromPlan =
		planned?.config.bigramsTargeted && planned.config.bigramsTargeted.length > 0
			? { targets: planned.config.bigramsTargeted, mix: planned.drillMix }
			: null;
	const resolved = fromPlan ?? (await resolveDrillMix(routeMode, corpus.bigramFrequencies));

	const seq = generateText({
		kind: 'bigram-drill',
		corpus,
		targetBigrams: resolved.targets,
		wordCount: wordBudget
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
	const recent = await getRecentSessions();
	const report = recent.find((s) => s.type === 'diagnostic')?.diagnosticReport;
	return report?.baselineWPM ?? 0;
}
