import { loadBuiltinCorpus, generateText } from '$lib/corpus';
import { DEFAULT_BIGRAM_DRILL_WORD_BUDGET } from '$lib/support/core';
import type { DrillMode } from '$lib/support/core';
import { getProfile } from '$lib/settings';
import { getRecentSessions } from '$lib/support/storage';
import { consumePlannedSession, resolveDrillMix } from '$lib/plan';
import { computeBigramDebts } from '$lib/skill';

interface BigramDrillSessionInputs {
	text: string;
	targets: readonly string[];
	exposure: readonly string[];
	drillMode: DrillMode;
	baselineWPM: number;
	/** Accuracy drills only — clean repeats each target still owes from history. */
	initialDebt?: ReadonlyMap<string, number>;
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
	const language = profile?.language ?? 'en';
	const secondaryMix = profile?.secondaryMix ?? 0;
	const secondaryLanguage =
		profile?.secondaryLanguage && profile.secondaryLanguage !== language && secondaryMix > 0
			? profile.secondaryLanguage
			: undefined;

	const [corpus, secondaryCorpus] = await Promise.all([
		loadBuiltinCorpus(language),
		secondaryLanguage ? loadBuiltinCorpus(secondaryLanguage) : Promise.resolve(undefined)
	]);

	const fromPlan =
		planned?.config.bigramsTargeted && planned.config.bigramsTargeted.length > 0
			? { targets: planned.config.bigramsTargeted, mix: planned.drillMix }
			: null;
	const resolved = fromPlan ?? (await resolveDrillMix(routeMode, corpus.bigramFrequencies));

	const seq = generateText({
		kind: 'bigram-drill',
		corpus,
		secondaryCorpus,
		secondaryMix,
		targetBigrams: resolved.targets,
		wordCount: wordBudget
	});

	const recent = await getRecentSessions();
	const baselineWPM =
		recent.find((s) => s.type === 'diagnostic')?.diagnosticReport?.baselineWPM ?? 0;

	return {
		text: seq.text,
		targets: resolved.targets,
		exposure: resolved.mix?.exposure ?? [],
		drillMode: routeMode,
		baselineWPM,
		initialDebt: routeMode === 'accuracy' ? computeBigramDebts(recent, resolved.targets) : undefined
	};
}
