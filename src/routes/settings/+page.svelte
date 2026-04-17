<script lang="ts">
	/**
	 * Settings page (Phase 6.5.1): surfaces the three knobs that live
	 * on `UserSettings` — language + corpus, session word budgets, and
	 * classification thresholds. Persists via `saveProfile`; consumers
	 * (session routes, planner) read back via `getProfile` and fall
	 * back to the `DEFAULT_*` constants when fields are absent.
	 *
	 * Explicit Save button rather than auto-save on every keystroke: a
	 * threshold change between half-typed states is rarely what the
	 * user means, and the number inputs are forgiving of intermediate
	 * values anyway. Reset-to-defaults just rewrites the row with the
	 * factory shape — simpler than a "clear the override" toggle per
	 * field, and reversible in one click.
	 */
	import { onMount } from 'svelte';
	import { getProfile, saveProfile } from '$lib/storage/service';
	import {
		DEFAULT_SPEED_THRESHOLD_MS,
		DEFAULT_HIGH_ERROR_THRESHOLD,
		DEFAULT_BIGRAM_DRILL_WORD_BUDGET,
		DEFAULT_REAL_TEXT_WORD_BUDGET,
		DEFAULT_DIAGNOSTIC_WORD_BUDGET,
		type Language,
		type UserSettings
	} from '$lib/models';
	import { BUILTIN_CORPUS_IDS, type BuiltinCorpusId } from '$lib/corpus/registry';

	/**
	 * Source of truth for what the factory-fresh profile looks like.
	 * Used on first mount (before any save) and by the reset button.
	 * Kept as a function so each reset produces a fresh object rather
	 * than mutating a shared reference.
	 */
	function buildDefaults(): UserSettings {
		return {
			languages: ['en'],
			corpusIds: ['en-top-1000'],
			thresholds: {
				speedMs: DEFAULT_SPEED_THRESHOLD_MS,
				errorRate: DEFAULT_HIGH_ERROR_THRESHOLD
			},
			wordBudgets: {
				bigramDrill: DEFAULT_BIGRAM_DRILL_WORD_BUDGET,
				realText: DEFAULT_REAL_TEXT_WORD_BUDGET,
				diagnostic: DEFAULT_DIAGNOSTIC_WORD_BUDGET
			}
		};
	}

	/**
	 * Filter the full built-in corpus list to just the ids that match
	 * a language. Drives the "which corpus for this language" picker
	 * after the user checks a language box.
	 */
	function corporaFor(language: Language): BuiltinCorpusId[] {
		return BUILTIN_CORPUS_IDS.filter((id) => id.startsWith(`${language}-`)) as BuiltinCorpusId[];
	}

	/**
	 * Default corpus per language. Used when the user toggles a
	 * language on — we pick the smallest/top list as the sensible
	 * starting point rather than force an explicit choice.
	 */
	const DEFAULT_CORPUS_PER_LANGUAGE: Record<Language, BuiltinCorpusId> = {
		en: 'en-top-1000',
		fr: 'fr-top-1500'
	};

	type LoadState = 'loading' | 'ready' | 'error';
	let loadState = $state<LoadState>('loading');
	let loadError = $state<string | null>(null);
	/** Form state — bound to inputs. Initialized from profile on mount. */
	let form = $state<UserSettings>(buildDefaults());
	let saving = $state(false);
	let saveError = $state<string | null>(null);
	let savedAt = $state<Date | null>(null);

	onMount(async () => {
		try {
			const stored = await getProfile();
			if (stored) {
				// Merge over defaults so a legacy profile missing
				// `wordBudgets` or `thresholds` still renders sane
				// values instead of `undefined` in the inputs.
				const defaults = buildDefaults();
				form = {
					...defaults,
					...stored,
					thresholds: { ...defaults.thresholds!, ...(stored.thresholds ?? {}) },
					wordBudgets: { ...defaults.wordBudgets!, ...(stored.wordBudgets ?? {}) }
				};
			}
			loadState = 'ready';
		} catch (err) {
			loadError = err instanceof Error ? err.message : 'Failed to load settings.';
			loadState = 'error';
		}
	});

	/**
	 * Toggle a language on/off. Turning a language *on* auto-adds its
	 * default corpus; turning it *off* strips the corresponding id.
	 * Priority order is preserved by language: English first if both
	 * are selected.
	 */
	function toggleLanguage(lang: Language, checked: boolean) {
		if (checked) {
			if (form.languages.includes(lang)) return;
			const next = [...form.languages, lang].sort((a, b) => (a === 'en' ? -1 : b === 'en' ? 1 : 0));
			const nextIds = next.map(
				(l) => form.corpusIds[form.languages.indexOf(l)] ?? DEFAULT_CORPUS_PER_LANGUAGE[l] ?? ''
			);
			// Language newly added hasn't got an index in the old
			// array; backfill with its default.
			for (let i = 0; i < next.length; i++) {
				if (!nextIds[i]) nextIds[i] = DEFAULT_CORPUS_PER_LANGUAGE[next[i]];
			}
			form.languages = next;
			form.corpusIds = nextIds;
		} else {
			// Require at least one language selected — otherwise the
			// app has nothing to draw a corpus from. Silently ignore
			// an "uncheck the last one" click; the checkbox stays on.
			if (form.languages.length <= 1) return;
			const idx = form.languages.indexOf(lang);
			if (idx === -1) return;
			form.languages = form.languages.filter((l) => l !== lang);
			form.corpusIds = form.corpusIds.filter((_, i) => i !== idx);
		}
	}

	function setCorpusFor(lang: Language, id: BuiltinCorpusId) {
		const idx = form.languages.indexOf(lang);
		if (idx === -1) return;
		const next = [...form.corpusIds];
		next[idx] = id;
		form.corpusIds = next;
	}

	function corpusFor(lang: Language): BuiltinCorpusId | undefined {
		const idx = form.languages.indexOf(lang);
		return idx === -1 ? undefined : (form.corpusIds[idx] as BuiltinCorpusId | undefined);
	}

	async function save() {
		saving = true;
		saveError = null;
		try {
			await saveProfile($state.snapshot(form) as UserSettings);
			savedAt = new Date();
		} catch (err) {
			saveError = err instanceof Error ? err.message : 'Failed to save settings.';
		} finally {
			saving = false;
		}
	}

	async function reset() {
		form = buildDefaults();
		await save();
	}
</script>

<div class="mx-auto max-w-3xl space-y-14">
	<header class="space-y-3">
		<p class="text-xs font-medium tracking-[0.18em] text-base-content/50 uppercase">
			Preferences · v0.1
		</p>
		<h1 class="text-4xl font-semibold tracking-tight text-base-content">Tune the trainer</h1>
		<p class="max-w-xl text-base-content/65">
			Language, word budgets, classification thresholds. Stored locally — no account, no sync.
		</p>
	</header>

	{#if loadState === 'loading'}
		<p class="text-base-content/60">Loading…</p>
	{:else if loadState === 'error'}
		<p class="text-error" role="alert">{loadError}</p>
	{:else}
		<section class="space-y-6" aria-labelledby="lang-heading">
			<div class="flex items-baseline gap-4">
				<span class="font-mono text-xs text-base-content/40 tabular-nums">01</span>
				<h2 id="lang-heading" class="text-xl font-semibold tracking-tight">Language</h2>
			</div>
			<p class="max-w-xl text-sm text-base-content/65">
				Pick what you want to practice. English leads when both are on. The corpus drives every
				passage the trainer shows you.
			</p>

			<dl class="divide-y divide-base-300 border-y border-base-300">
				{#each ['en', 'fr'] as lang (lang)}
					{@const typedLang = lang as Language}
					{@const enabled = form.languages.includes(typedLang)}
					{@const label = typedLang === 'en' ? 'English' : 'French'}
					<div class="flex items-center justify-between gap-6 py-4">
						<dt>
							<label class="flex cursor-pointer items-center gap-3">
								<input
									type="checkbox"
									class="peer sr-only"
									checked={enabled}
									onchange={(e) =>
										toggleLanguage(typedLang, (e.target as HTMLInputElement).checked)}
									data-testid={`lang-${typedLang}`}
								/>
								<!--
									Custom square pip instead of daisyUI checkbox: a filled
									square in primary on check, empty with a hairline
									border otherwise. Pairs tonally with the typed-char
									state blocks on the drill surface.
								-->
								<span
									class="inline-block h-3.5 w-3.5 rounded-[2px] border border-base-content/35 transition-colors peer-checked:border-primary peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-primary/50 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-base-100"
									aria-hidden="true"
								></span>
								<span class="text-sm font-medium">{label}</span>
							</label>
						</dt>
						<dd>
							{#if enabled}
								<select
									class="min-w-[10rem] appearance-none border-b border-base-content/20 bg-transparent py-1 text-right font-mono text-sm tabular-nums outline-none focus:border-primary"
									value={corpusFor(typedLang)}
									onchange={(e) =>
										setCorpusFor(
											typedLang,
											(e.target as HTMLSelectElement).value as BuiltinCorpusId
										)}
									data-testid={`corpus-${typedLang}`}
									aria-label={`${label} corpus`}
								>
									{#each corporaFor(typedLang) as id (id)}
										<option value={id}>{id}</option>
									{/each}
								</select>
							{:else}
								<span class="font-mono text-xs text-base-content/30">off</span>
							{/if}
						</dd>
					</div>
				{/each}
			</dl>
		</section>

		<section class="space-y-6" aria-labelledby="budget-heading">
			<div class="flex items-baseline gap-4">
				<span class="font-mono text-xs text-base-content/40 tabular-nums">02</span>
				<h2 id="budget-heading" class="text-xl font-semibold tracking-tight">Word budgets</h2>
			</div>
			<p class="max-w-xl text-sm text-base-content/65">
				Words per mini-session. The daily plan stacks several of each, so smaller values mean more,
				shorter runs.
			</p>

			<dl class="divide-y divide-base-300 border-y border-base-300">
				<div class="flex items-center justify-between gap-6 py-4">
					<dt class="text-sm">
						<label for="budget-drill" class="cursor-pointer">Bigram drill</label>
						<span class="ml-2 font-mono text-xs text-base-content/40 tabular-nums"
							>default {DEFAULT_BIGRAM_DRILL_WORD_BUDGET}</span
						>
					</dt>
					<dd class="flex items-baseline gap-2">
						<input
							id="budget-drill"
							type="number"
							min="1"
							class="w-20 [appearance:textfield] border-b border-base-content/20 bg-transparent py-1 text-right font-mono text-sm tabular-nums outline-none focus:border-primary [&::-webkit-inner-spin-button]:hidden [&::-webkit-outer-spin-button]:hidden"
							bind:value={form.wordBudgets!.bigramDrill}
							data-testid="budget-drill"
						/>
						<span class="font-mono text-xs text-base-content/40">words</span>
					</dd>
				</div>
				<div class="flex items-center justify-between gap-6 py-4">
					<dt class="text-sm">
						<label for="budget-realtext" class="cursor-pointer">Real text</label>
						<span class="ml-2 font-mono text-xs text-base-content/40 tabular-nums"
							>default {DEFAULT_REAL_TEXT_WORD_BUDGET}</span
						>
					</dt>
					<dd class="flex items-baseline gap-2">
						<input
							id="budget-realtext"
							type="number"
							min="1"
							class="w-20 [appearance:textfield] border-b border-base-content/20 bg-transparent py-1 text-right font-mono text-sm tabular-nums outline-none focus:border-primary [&::-webkit-inner-spin-button]:hidden [&::-webkit-outer-spin-button]:hidden"
							bind:value={form.wordBudgets!.realText}
							data-testid="budget-realtext"
						/>
						<span class="font-mono text-xs text-base-content/40">words</span>
					</dd>
				</div>
				<div class="flex items-center justify-between gap-6 py-4">
					<dt class="text-sm">
						<label for="budget-diagnostic" class="cursor-pointer">Diagnostic</label>
						<span class="ml-2 font-mono text-xs text-base-content/40 tabular-nums"
							>default {DEFAULT_DIAGNOSTIC_WORD_BUDGET}</span
						>
					</dt>
					<dd class="flex items-baseline gap-2">
						<input
							id="budget-diagnostic"
							type="number"
							min="1"
							class="w-20 [appearance:textfield] border-b border-base-content/20 bg-transparent py-1 text-right font-mono text-sm tabular-nums outline-none focus:border-primary [&::-webkit-inner-spin-button]:hidden [&::-webkit-outer-spin-button]:hidden"
							bind:value={form.wordBudgets!.diagnostic}
							data-testid="budget-diagnostic"
						/>
						<span class="font-mono text-xs text-base-content/40">words</span>
					</dd>
				</div>
			</dl>
		</section>

		<section class="space-y-6" aria-labelledby="threshold-heading">
			<div class="flex items-baseline gap-4">
				<span class="font-mono text-xs text-base-content/40 tabular-nums">03</span>
				<h2 id="threshold-heading" class="text-xl font-semibold tracking-tight">Thresholds</h2>
			</div>
			<p class="max-w-xl text-sm text-base-content/65">
				When a bigram counts as fast or error-prone. Defaults are spec-derived (§3.1) — change only
				if you know what you're doing.
			</p>

			<dl class="divide-y divide-base-300 border-y border-base-300">
				<div class="flex items-center justify-between gap-6 py-4">
					<dt class="text-sm">
						<label for="threshold-speed" class="cursor-pointer">Speed</label>
						<span class="ml-2 font-mono text-xs text-base-content/40 tabular-nums"
							>default {DEFAULT_SPEED_THRESHOLD_MS}</span
						>
					</dt>
					<dd class="flex items-baseline gap-2">
						<input
							id="threshold-speed"
							type="number"
							min="1"
							class="w-20 [appearance:textfield] border-b border-base-content/20 bg-transparent py-1 text-right font-mono text-sm tabular-nums outline-none focus:border-primary [&::-webkit-inner-spin-button]:hidden [&::-webkit-outer-spin-button]:hidden"
							bind:value={form.thresholds!.speedMs}
							data-testid="threshold-speed"
						/>
						<span class="font-mono text-xs text-base-content/40">ms</span>
					</dd>
				</div>
				<div class="flex items-center justify-between gap-6 py-4">
					<dt class="text-sm">
						<label for="threshold-errorrate" class="cursor-pointer">Error rate</label>
						<span class="ml-2 font-mono text-xs text-base-content/40 tabular-nums"
							>default {(DEFAULT_HIGH_ERROR_THRESHOLD * 100).toFixed(1)}</span
						>
					</dt>
					<dd class="flex items-baseline gap-2">
						<input
							id="threshold-errorrate"
							type="number"
							min="0"
							max="100"
							step="0.1"
							class="w-20 [appearance:textfield] border-b border-base-content/20 bg-transparent py-1 text-right font-mono text-sm tabular-nums outline-none focus:border-primary [&::-webkit-inner-spin-button]:hidden [&::-webkit-outer-spin-button]:hidden"
							value={(form.thresholds!.errorRate * 100).toFixed(1)}
							oninput={(e) => {
								const pct = Number((e.target as HTMLInputElement).value);
								if (Number.isFinite(pct)) form.thresholds!.errorRate = pct / 100;
							}}
							data-testid="threshold-errorrate"
						/>
						<span class="font-mono text-xs text-base-content/40">%</span>
					</dd>
				</div>
			</dl>
		</section>

		<footer class="flex flex-wrap items-center gap-x-6 gap-y-3 pt-2">
			<button
				type="button"
				class="btn tracking-wide btn-primary"
				onclick={save}
				disabled={saving}
				data-testid="settings-save"
			>
				{saving ? 'Saving…' : 'Save changes'}
			</button>
			<button
				type="button"
				class="text-sm text-base-content/55 underline-offset-4 hover:text-base-content hover:underline disabled:pointer-events-none disabled:opacity-50"
				onclick={reset}
				disabled={saving}
				data-testid="settings-reset"
			>
				Reset to defaults
			</button>
			<div class="ml-auto text-sm" aria-live="polite">
				{#if saveError}
					<p class="text-error" role="alert">{saveError}</p>
				{:else if savedAt}
					<p class="font-mono text-base-content/45 tabular-nums">
						Saved · {savedAt.toLocaleTimeString()}
					</p>
				{/if}
			</div>
		</footer>
	{/if}
</div>
