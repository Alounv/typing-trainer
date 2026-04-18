<script lang="ts">
	/**
	 * Bigram drill route. Targets come from the dashboard hand-off stash.
	 * Direct nav (URL paste, dev) falls back to a small stub set.
	 */
	import { onMount } from 'svelte';
	import SessionShell from '$lib/session/components/SessionShell.svelte';
	import { loadBuiltinCorpus, isBuiltinCorpusId } from '$lib/corpus/registry';
	import { generateBigramDrillSequence } from '$lib/drill/bigram-drill';
	import { consumePlannedSession } from '$lib/scheduler/handoff';
	import { findGraduatedBigrams } from '$lib/scheduler/graduation-filter';
	import { DEFAULT_DRILL_TARGET_COUNT, selectDrillTargets } from '$lib/scheduler/planner';
	import { getBigramHistory, getProfile, getRecentSessions } from '$lib/storage/service';
	import { DEFAULT_BIGRAM_DRILL_WORD_BUDGET } from '$lib/models';

	/** Corpus used when the profile is absent or its id isn't a known built-in. */
	const FALLBACK_CORPUS_ID = 'en';

	/**
	 * Seed targets used only when no diagnostic has ever run (and therefore
	 * nothing in storage to prioritize). Once a diagnostic exists, drill
	 * targets always come from its priority list — even on direct nav /
	 * refresh, to stay consistent with what the dashboard would pick.
	 */
	const SEED_TARGETS = ['th', 'he', 'in', 'er', 'an'] as const;

	/** Mirrors dashboard-data.ts so direct nav matches dashboard-sourced nav. */
	const RECENT_WINDOW = 20;

	type LoadState =
		| { status: 'loading' }
		| {
				status: 'ready';
				text: string;
				targets: readonly string[];
				/** Subset of `targets` backfilled as exposure; empty for pure-priority drills. */
				exposure: readonly string[];
				/** No priority targets at all — drives the exposure-only header copy. */
				exposureOnly: boolean;
		  }
		| { status: 'error'; message: string };

	let state = $state<LoadState>({ status: 'loading' });

	onMount(async () => {
		try {
			const planned = consumePlannedSession('bigram-drill');
			// Profile drives word budget and corpus language. Planned sessions
			// already had the budget chosen upstream; we always read the profile
			// for corpus so a French user's drill uses French even from a plan card.
			const profile = await getProfile();
			const wordBudget =
				planned?.config.wordBudget ??
				profile?.wordBudgets?.bigramDrill ??
				DEFAULT_BIGRAM_DRILL_WORD_BUDGET;
			const pickedId = profile?.corpusIds?.[0];
			const corpusId = pickedId && isBuiltinCorpusId(pickedId) ? pickedId : FALLBACK_CORPUS_ID;

			const fromPlan =
				planned?.config.bigramsTargeted && planned.config.bigramsTargeted.length > 0
					? { targets: planned.config.bigramsTargeted, mix: planned.drillMix }
					: null;
			const resolved = fromPlan ?? (await resolveDirectNavMix());

			const exposure = resolved.mix?.exposure ?? [];
			const priorityCount = resolved.mix?.priority?.length ?? resolved.targets.length;
			const exposureOnly = priorityCount === 0 && exposure.length > 0;

			const corpus = await loadBuiltinCorpus(corpusId);
			const seq = generateBigramDrillSequence({
				targetBigrams: resolved.targets,
				corpus,
				options: { wordCount: wordBudget }
			});
			state = { status: 'ready', text: seq.text, targets: resolved.targets, exposure, exposureOnly };
		} catch (err) {
			state = {
				status: 'error',
				message: err instanceof Error ? err.message : 'Failed to build drill.'
			};
		}
	});

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
</script>

{#if state.status === 'loading'}
	<p class="mx-auto max-w-3xl text-base-content/70">Loading drill…</p>
{:else if state.status === 'error'}
	<p class="mx-auto max-w-3xl text-error" role="alert">{state.message}</p>
{:else}
	<!-- Header copy flexes by mix — priority-only / mixed / exposure-only. -->
	<SessionShell
		type="bigram-drill"
		text={state.text}
		title="Bigram drill"
		what={state.exposureOnly
			? 'Exposure practice on frequent bigrams. Not enough data yet to diagnose specific weaknesses — this drill builds up samples so the next diagnostic can pinpoint them.'
			: state.exposure.length > 0
				? 'Targeted practice mixing bigrams your diagnostic flagged as weak with frequent bigrams we still need more data on. The passage over-samples all of them.'
				: 'Targeted practice on the bigrams your last diagnostic flagged. The passage over-samples them so each target recurs many times per minute.'}
		approach="Accuracy over speed. Mistype, correct, continue — every transition is measured, so a rushed pass doesn't help."
		targetBigrams={state.targets}
		exposureBigrams={state.exposure}
	/>
{/if}
