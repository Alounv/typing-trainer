/**
 * Session-setup loaders for the three session routes.
 *
 * Each `prepare*Session` is the single entry point a route needs: it pulls
 * the user profile, picks the corpus, consumes any dashboard hand-off, and
 * runs the pure text-generator. Returns a ready-to-render bundle so the
 * route is pure presentation (loading / error / ready).
 *
 * Why one file (not per-type): the three setups overlap heavily on corpus
 * resolution and word-budget handling. Keeping them together deduplicates
 * that, and makes it obvious where a new session type would slot in.
 */
import {
	loadBuiltinCorpus,
	isBuiltinCorpusId,
	loadQuoteBank,
	hasQuoteBank,
	type BuiltinCorpusId,
	type FrequencyTable
} from '../corpus';
import type { DrillMode, UserSettings } from '../core';
import {
	getProfile,
	DEFAULT_BIGRAM_DRILL_WORD_BUDGET,
	DEFAULT_REAL_TEXT_WORD_BUDGET,
	DEFAULT_DIAGNOSTIC_WORD_BUDGET
} from '../settings';
import { getBigramHistory, getRecentSessions } from '../storage';
import { consumePlannedSession } from './planned';
import { generateBigramDrillSequence } from './bigram-drill';
import { generateRealTextSequence } from './real-text';
import { sampleDiagnosticPassage } from './diagnostic-sampler';
import { findGraduatedBigrams } from './graduation-filter';
import { DEFAULT_DRILL_TARGET_COUNT, selectDrillTargets } from './planner';

/** 5 chars ≈ 1 word — translates word budget into char targets for samplers. */
const CHARS_PER_WORD = 5;

/** Corpus used when the profile is absent or its id isn't a known built-in. */
const FALLBACK_CORPUS_ID: BuiltinCorpusId = 'en';

/** Mirrors dashboard-loader's window so direct nav matches dashboard-sourced nav. */
const RECENT_WINDOW = 20;

/**
 * Seed targets used only when no diagnostic has ever run (and therefore
 * nothing in storage to prioritize). Once a diagnostic exists, drill
 * targets always come from its priority list — even on direct nav /
 * refresh, to stay consistent with what the dashboard would pick.
 */
const SEED_TARGETS = ['th', 'he', 'in', 'er', 'an'] as const;

export interface BigramDrillSessionInputs {
	text: string;
	targets: readonly string[];
	/** Subset of `targets` backfilled as exposure; empty for pure-priority drills. */
	exposure: readonly string[];
	/**
	 * Treatment mode. From a planned session's config when present; otherwise
	 * defaults to `accuracy` for direct nav — the safer fallback because
	 * accuracy mode doesn't apply speed pressure to bigrams we don't know
	 * the classification of.
	 */
	drillMode: DrillMode;
	/**
	 * Latest diagnostic baseline WPM. Drives pacer speed. 0 when no
	 * diagnostic has run — the shell then skips ghost rendering.
	 */
	baselineWPM: number;
}

export interface RealTextSessionInputs {
	text: string;
}

export interface DiagnosticSessionInputs {
	text: string;
	corpusBigramFrequencies: FrequencyTable;
}

export async function prepareBigramDrillSession(): Promise<BigramDrillSessionInputs> {
	// Profile drives word budget and corpus language. Planned sessions
	// already had the budget chosen upstream; we always read the profile
	// for corpus so a French user's drill uses French even from a plan card.
	const planned = consumePlannedSession('bigram-drill');
	const profile = await getProfile();
	const wordBudget =
		planned?.config.wordBudget ??
		profile?.wordBudgets?.bigramDrill ??
		DEFAULT_BIGRAM_DRILL_WORD_BUDGET;
	const corpusId = resolveCorpusId(profile);

	const fromPlan =
		planned?.config.bigramsTargeted && planned.config.bigramsTargeted.length > 0
			? { targets: planned.config.bigramsTargeted, mix: planned.drillMix }
			: null;
	const resolved = fromPlan ?? (await resolveDirectNavMix());

	const exposure = resolved.mix?.exposure ?? [];

	const corpus = await loadBuiltinCorpus(corpusId);
	const seq = generateBigramDrillSequence({
		targetBigrams: resolved.targets,
		corpus,
		options: { wordCount: wordBudget }
	});
	// Planned sessions carry the mode forward from the planner. Direct nav has
	// no planner to defer to; we pick accuracy as the conservative default
	// (see `drillMode` doc on `BigramDrillSessionInputs`).
	const drillMode: DrillMode = planned?.config.drillMode ?? 'accuracy';

	// Baseline for the pacer. Independent of the target selection — we always
	// want the most recent baseline, even when the planner already resolved
	// targets from an earlier report. Zero when no diagnostic exists, which
	// the shell interprets as "hide the ghost cursor."
	const baselineWPM = await getLatestBaselineWPM();

	return {
		text: seq.text,
		targets: resolved.targets,
		exposure,
		drillMode,
		baselineWPM
	};
}

/**
 * Latest baseline WPM from the most recent diagnostic report. Returns 0 if no
 * diagnostic session is on file — caller treats this as "no pacer yet."
 */
async function getLatestBaselineWPM(): Promise<number> {
	const recent = await getRecentSessions(RECENT_WINDOW);
	const report = recent.find((s) => s.type === 'diagnostic')?.diagnosticReport;
	return report?.baselineWPM ?? 0;
}

export async function prepareRealTextSession(): Promise<RealTextSessionInputs> {
	// Dashboard hand-off: the scheduler chooses the word budget for a
	// planned session. Corpus + quote bank always come from the profile
	// (even for planned sessions) so a French user gets French prose
	// regardless of how they kicked off the session.
	const planned = consumePlannedSession('real-text');
	const profile = await getProfile();
	const wordBudget =
		planned?.config.wordBudget ?? profile?.wordBudgets?.realText ?? DEFAULT_REAL_TEXT_WORD_BUDGET;
	const targetChars = wordBudget * CHARS_PER_WORD;
	const corpusId = resolveCorpusId(profile);
	const language = profile?.languages?.[0] ?? 'en';

	// Quote bank is the primary source; corpus is the synth fallback when
	// the bank runs out of quotes before hitting target chars. The bank is
	// optional — an unsupported language drops through to synth-only, which
	// still produces valid text.
	const [bank, corpus] = await Promise.all([
		hasQuoteBank(language) ? loadQuoteBank(language) : Promise.resolve(undefined),
		loadBuiltinCorpus(corpusId)
	]);
	const seq = generateRealTextSequence({
		quoteBank: bank,
		fallbackCorpus: corpus,
		options: { targetLengthChars: targetChars }
	});
	return { text: seq.text };
}

export async function prepareDiagnosticSession(): Promise<DiagnosticSessionInputs> {
	// Profile drives language/corpus; unknown ids fall back to English.
	const profile = await getProfile();
	const corpusId = resolveCorpusId(profile);

	// Load the corpus (wordlist + language bigram table) and the quote
	// bank in parallel. The quote bank is optional — languages without
	// one fall through to synth-path word sampling inside the sampler.
	const corpus = await loadBuiltinCorpus(corpusId);
	const quoteBank = hasQuoteBank(corpus.config.language)
		? await loadQuoteBank(corpus.config.language)
		: undefined;

	const wordBudget = profile?.wordBudgets?.diagnostic ?? DEFAULT_DIAGNOSTIC_WORD_BUDGET;
	const passage = sampleDiagnosticPassage(corpus, {
		targetChars: wordBudget * CHARS_PER_WORD,
		quoteBank
	});
	return {
		text: passage.text,
		corpusBigramFrequencies: corpus.bigramFrequencies
	};
}

/**
 * Pick targets without a dashboard hand-off. Mirrors the planner's
 * selection (including undertrained backfill) so direct nav and plan
 * nav agree. Falls back to SEED_TARGETS only when there's no diagnostic
 * on file.
 */
async function resolveDirectNavMix(): Promise<{
	targets: readonly string[];
	mix?: { priority: string[]; exposure: string[] };
}> {
	const recent = await getRecentSessions(RECENT_WINDOW);
	const report = recent.find((s) => s.type === 'diagnostic')?.diagnosticReport;
	if (!report) return { targets: SEED_TARGETS };

	const priority = report.priorityTargets.map((p) => p.bigram);
	const graduated = await findGraduatedBigrams(priority, getBigramHistory);
	const mix = selectDrillTargets(
		priority,
		report.corpusFit.undertrained,
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
