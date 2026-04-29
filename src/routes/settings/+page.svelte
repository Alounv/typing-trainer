<script lang="ts">
	/**
	 * Settings page (Phase 6.5.1): surfaces the three knobs that live
	 * on `UserSettings` — language + corpus, session word budgets, and
	 * classification thresholds. Persists via `saveProfile`; consumers
	 * (session routes, planner) read back via `getProfile` and fall
	 * back to the `DEFAULT_*` constants when fields are absent.
	 *
	 * Auto-save on edit (Phase 6.5.2): each field change kicks a short
	 * debounced save rather than gating behind a "Save" button. The
	 * debounce is long enough that number inputs don't write a profile
	 * per keystroke, short enough that a user leaving the page feels
	 * confident their changes stuck. The timestamp + error live-region
	 * in the footer is the single source of feedback.
	 */
	import { onMount } from 'svelte';
	import { getProfile, saveProfile, buildDefaultProfile, withDefaults } from '$lib/settings';
	import { VERSION } from '$lib/version';
	import {
		DEFAULT_BIGRAM_DRILL_WORD_BUDGET,
		DEFAULT_REAL_TEXT_WORD_BUDGET,
		DEFAULT_DIAGNOSTIC_WORD_BUDGET,
		DEFAULT_SPEED_THRESHOLD_MS,
		DEFAULT_HIGH_ERROR_THRESHOLD,
		DEFAULT_CYCLES_PER_DAY,
		DEFAULT_ACCURACY_DRILLS_PER_CYCLE,
		DEFAULT_SPEED_DRILLS_PER_CYCLE
	} from '$lib/support/core';
	import type { Language, UserSettings } from '$lib/support/core';
	import DataTransfer from '$lib/settings/DataTransfer.svelte';

	type LoadState = 'loading' | 'ready' | 'error';
	let loadState = $state<LoadState>('loading');
	let loadError = $state<string | null>(null);
	/** Form state — bound to inputs. Initialized from profile on mount. */
	let form = $state<UserSettings>(buildDefaultProfile());
	let saving = $state(false);
	let saveError = $state<string | null>(null);
	let savedAt = $state<Date | null>(null);

	/**
	 * Debounce window for auto-save (ms). Long enough that dragging a
	 * number input past several intermediate values writes one row, not
	 * seven; short enough that stepping away after an edit still
	 * captures it before the user navigates.
	 */
	const AUTO_SAVE_DEBOUNCE_MS = 400;

	onMount(async () => {
		try {
			const stored = await getProfile();
			// Merge over defaults so a legacy profile missing `wordBudgets`
			// or `thresholds` still renders sane values instead of
			// `undefined` in the inputs.
			if (stored) form = withDefaults(stored);
			loadState = 'ready';
		} catch (err) {
			loadError = err instanceof Error ? err.message : 'Failed to load settings.';
			loadState = 'error';
		}
	});

	/**
	 * Auto-save: debounced `$effect` that reacts to any change in
	 * `form` once the page has finished loading. The `loadState` guard
	 * prevents the effect's initial run (which fires against the
	 * pre-load defaults) from writing the factory shape over an
	 * existing profile. The timer handle in the cleanup closure ensures
	 * an edit followed immediately by another edit collapses into one
	 * save.
	 */
	$effect(() => {
		if (loadState !== 'ready') return;
		// Read through the reactive form so the effect re-runs on any
		// leaf change. `$state.snapshot` is called inside the timer so
		// what gets saved is the value at debounce-fire time, not the
		// older value captured when the edit started.
		$state.snapshot(form);

		const handle = setTimeout(() => {
			void save();
		}, AUTO_SAVE_DEBOUNCE_MS);
		return () => clearTimeout(handle);
	});

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

	function reset() {
		// The reactive assignment triggers the auto-save effect — no need
		// to call `save()` directly. Keeps the reset path identical to any
		// other edit, so there's one save code path, not two.
		form = buildDefaultProfile();
	}
</script>

<div class="mx-auto max-w-3xl space-y-14">
	<header class="space-y-3">
		<p class="text-xs font-medium tracking-[0.18em] text-base-content/50 uppercase">
			Preferences · {VERSION}
		</p>
		<h1 class="text-4xl font-semibold tracking-tight text-base-content">Tune the trainer</h1>
		<p class="max-w-xl text-base-content/65">
			Language, word budgets, classification thresholds, plan structure. Stored locally — no
			account, no sync.
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
			<p class="max-w-xl text-sm text-base-content/65">Pick what you want to practice.</p>

			<dl class="divide-y divide-base-300 border-y border-base-300">
				{#each ['en', 'fr'] as lang (lang)}
					{@const typedLang = lang as Language}
					{@const selected = form.language === typedLang}
					{@const label = typedLang === 'en' ? 'English' : 'French'}
					<div class="flex items-center justify-between gap-6 py-4">
						<dt>
							<label class="flex cursor-pointer items-center gap-3">
								<input
									type="radio"
									name="language"
									class="peer sr-only"
									value={typedLang}
									checked={selected}
									onchange={() => (form.language = typedLang)}
									data-testid={`lang-${typedLang}`}
								/>
								<!-- Custom square pip; tonal match with the drill surface. -->
								<span
									class="inline-block h-3.5 w-3.5 rounded-[2px] border border-base-content/35 transition-colors peer-checked:border-primary peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-primary/50 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-base-100"
									aria-hidden="true"
								></span>
								<span class="text-sm font-medium">{label}</span>
							</label>
						</dt>
						<dd>
							<span class="font-mono text-xs text-base-content/30">
								{selected ? 'on' : 'off'}
							</span>
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
				When a bigram counts as fast or error-prone.
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

		<section class="space-y-6" aria-labelledby="plan-heading">
			<div class="flex items-baseline gap-4">
				<span class="font-mono text-xs text-base-content/40 tabular-nums">04</span>
				<h2 id="plan-heading" class="text-xl font-semibold tracking-tight">Plan structure</h2>
			</div>
			<p class="max-w-xl text-sm text-base-content/65">
				How many cycles per day, and how many accuracy/speed drill repetitions per cycle. Each cycle
				ends with a real-text run.
			</p>

			<dl class="divide-y divide-base-300 border-y border-base-300">
				<div class="flex items-center justify-between gap-6 py-4">
					<dt class="text-sm">
						<label for="plan-cycles" class="cursor-pointer">Cycles per day</label>
						<span class="ml-2 font-mono text-xs text-base-content/40 tabular-nums"
							>default {DEFAULT_CYCLES_PER_DAY}</span
						>
					</dt>
					<dd class="flex items-baseline gap-2">
						<input
							id="plan-cycles"
							type="number"
							min="1"
							max="10"
							class="w-20 [appearance:textfield] border-b border-base-content/20 bg-transparent py-1 text-right font-mono text-sm tabular-nums outline-none focus:border-primary [&::-webkit-inner-spin-button]:hidden [&::-webkit-outer-spin-button]:hidden"
							bind:value={form.planStructure!.cyclesPerDay}
							data-testid="plan-cycles"
						/>
						<span class="font-mono text-xs text-base-content/40">cycles</span>
					</dd>
				</div>
				<div class="flex items-center justify-between gap-6 py-4">
					<dt class="text-sm">
						<label for="plan-accuracy" class="cursor-pointer">Accuracy drills per cycle</label>
						<span class="ml-2 font-mono text-xs text-base-content/40 tabular-nums"
							>default {DEFAULT_ACCURACY_DRILLS_PER_CYCLE}</span
						>
					</dt>
					<dd class="flex items-baseline gap-2">
						<input
							id="plan-accuracy"
							type="number"
							min="0"
							max="10"
							class="w-20 [appearance:textfield] border-b border-base-content/20 bg-transparent py-1 text-right font-mono text-sm tabular-nums outline-none focus:border-primary [&::-webkit-inner-spin-button]:hidden [&::-webkit-outer-spin-button]:hidden"
							bind:value={form.planStructure!.accuracyDrillsPerCycle}
							data-testid="plan-accuracy"
						/>
						<span class="font-mono text-xs text-base-content/40">reps</span>
					</dd>
				</div>
				<div class="flex items-center justify-between gap-6 py-4">
					<dt class="text-sm">
						<label for="plan-speed" class="cursor-pointer">Speed drills per cycle</label>
						<span class="ml-2 font-mono text-xs text-base-content/40 tabular-nums"
							>default {DEFAULT_SPEED_DRILLS_PER_CYCLE}</span
						>
					</dt>
					<dd class="flex items-baseline gap-2">
						<input
							id="plan-speed"
							type="number"
							min="0"
							max="10"
							class="w-20 [appearance:textfield] border-b border-base-content/20 bg-transparent py-1 text-right font-mono text-sm tabular-nums outline-none focus:border-primary [&::-webkit-inner-spin-button]:hidden [&::-webkit-outer-spin-button]:hidden"
							bind:value={form.planStructure!.speedDrillsPerCycle}
							data-testid="plan-speed"
						/>
						<span class="font-mono text-xs text-base-content/40">reps</span>
					</dd>
				</div>
			</dl>
		</section>

		<DataTransfer />

		<!--
			No Save button: edits auto-persist shortly after the user
			stops. The status line is the only feedback the footer needs,
			so it owns the whole row. "Reset to defaults" lives on the
			right as the only action the user can still trigger manually,
			styled as a quiet text link so it doesn't pull focus in idle
			state.
		-->
		<footer class="flex flex-wrap items-center gap-x-6 gap-y-3 pt-2">
			<div class="text-sm" aria-live="polite">
				{#if saveError}
					<p class="text-error" role="alert">{saveError}</p>
				{:else if saving}
					<p class="font-mono text-base-content/45 tabular-nums">Saving…</p>
				{:else if savedAt}
					<p class="font-mono text-base-content/45 tabular-nums">
						Saved · {savedAt.toLocaleTimeString()}
					</p>
				{/if}
			</div>
			<button
				type="button"
				class="ml-auto text-sm text-base-content/55 underline-offset-4 hover:text-base-content hover:underline disabled:pointer-events-none disabled:opacity-50"
				onclick={reset}
				disabled={saving}
				data-testid="settings-reset"
			>
				Reset to defaults
			</button>
		</footer>
	{/if}
</div>
