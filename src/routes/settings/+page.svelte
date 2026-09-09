<script lang="ts">
	/**
	 * `UserSettings.thresholds` is deliberately absent from this page: editing it
	 * silently re-scores every past session. A profile that already carries
	 * custom values still honours them.
	 *
	 * There is no Save button — edits debounce into `saveProfile`, and the
	 * timestamp and error live-region in the footer are the only feedback.
	 */
	import { onMount } from 'svelte';
	import { getProfile, saveProfile, buildDefaultProfile, withDefaults } from '$lib/settings';
	import { VERSION } from '$lib/version';
	import { DEFAULT_PASSAGE_WORDS } from '$lib/support/core';
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
			// Merge over defaults so a legacy profile missing a field still
			// renders a sane value instead of `undefined` in the inputs.
			if (stored) form = withDefaults(stored);
			loadState = 'ready';
		} catch (err) {
			loadError = err instanceof Error ? err.message : 'Failed to load settings.';
			loadState = 'error';
		}
	});

	/**
	 * The effect's first run after load is caused by the profile arriving, not
	 * by the user changing anything. Saving there wrote a row on a mere page
	 * visit and — worse — lit up "Saved ·" before any edit, so a later edit's
	 * save was indistinguishable from this one.
	 */
	let pristine = true;

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

		if (pristine) {
			pristine = false;
			return;
		}

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

	/** Default secondary share when the user first picks a second language. */
	const DEFAULT_SECONDARY_MIX = 30;

	// Long Tailwind strings, named once. Full literals so the JIT still sees them.
	const PIP =
		'inline-block h-3.5 w-3.5 rounded-[2px] border border-base-content/35 transition-colors peer-checked:border-primary peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-primary/50 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-base-100';
	const NUMBER_INPUT =
		'w-20 [appearance:textfield] border-b border-base-content/20 bg-transparent py-1 text-right font-mono text-sm tabular-nums outline-none focus:border-primary [&::-webkit-inner-spin-button]:hidden [&::-webkit-outer-spin-button]:hidden';

	const LANGUAGE_LABEL: Record<'off' | Language, string> = {
		off: 'Off',
		en: 'English',
		fr: 'French'
	};

	function setPrimary(value: Language) {
		form.language = value;
		// Collision: silently demote the secondary so the two never agree.
		if (form.secondaryLanguage === value) {
			form.secondaryLanguage = undefined;
			form.secondaryMix = 0;
		}
	}

	type SecondaryChoice = 'off' | Language;
	function currentSecondary(): SecondaryChoice {
		return form.secondaryLanguage ?? 'off';
	}
	let mixActive = $derived(!!form.secondaryLanguage);
	function setSecondary(value: SecondaryChoice) {
		if (value === 'off') {
			form.secondaryLanguage = undefined;
			form.secondaryMix = 0;
		} else {
			form.secondaryLanguage = value;
			if (!form.secondaryMix) form.secondaryMix = DEFAULT_SECONDARY_MIX;
		}
	}
</script>

<!--
	Every tunable number reads the same way: what it is, what it defaults to, the
	value, its unit. One snippet so the three of them can't drift apart.
-->
{#snippet numberRow(row: {
	id: string;
	label: string;
	fallback: string | number;
	value: string | number;
	unit: string;
	onInput: (value: number) => void;
	min?: string;
	max?: string;
	step?: string;
})}
	<div class="flex items-center justify-between gap-6 py-4">
		<dt class="text-sm">
			<label for={row.id} class="cursor-pointer">{row.label}</label>
			<span class="ml-2 font-mono text-xs text-base-content/40 tabular-nums"
				>default {row.fallback}</span
			>
		</dt>
		<dd class="flex items-baseline gap-2">
			<input
				id={row.id}
				type="number"
				min={row.min ?? '1'}
				max={row.max}
				step={row.step}
				class={NUMBER_INPUT}
				value={row.value}
				oninput={(e) => {
					const parsed = Number((e.target as HTMLInputElement).value);
					if (Number.isFinite(parsed)) row.onInput(parsed);
				}}
				data-testid={row.id}
			/>
			<span class="font-mono text-xs text-base-content/40">{row.unit}</span>
		</dd>
	</div>
{/snippet}

<div class="mx-auto max-w-3xl space-y-14">
	<header class="space-y-3">
		<p class="text-xs font-medium tracking-[0.18em] text-base-content/50 uppercase">
			Preferences · {VERSION}
		</p>
		<h1 class="text-4xl font-semibold tracking-tight text-base-content">Tune the trainer</h1>
		<p class="max-w-xl text-base-content/65">
			Language, passage length, and how a session opens. Stored locally — no account, no sync.
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
					{@const label = LANGUAGE_LABEL[typedLang]}
					<div class="flex items-center justify-between gap-6 py-4">
						<dt>
							<label class="flex cursor-pointer items-center gap-3">
								<input
									type="radio"
									name="language"
									class="peer sr-only"
									value={typedLang}
									checked={selected}
									onchange={() => setPrimary(typedLang)}
									data-testid={`lang-${typedLang}`}
								/>
								<!-- Custom square pip; tonal match with the drill surface. -->
								<span class={PIP} aria-hidden="true"></span>
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

			<div class="space-y-3 pt-2">
				<h3 class="text-sm font-semibold tracking-tight">Mix in a second language</h3>
				<p class="max-w-xl text-sm text-base-content/65">
					Optionally draw some passages from a second language's quote bank.
				</p>
			</div>

			<dl class="divide-y divide-base-300 border-y border-base-300">
				{#each ['off', 'en', 'fr'] as choice (choice)}
					{@const typedChoice = choice as SecondaryChoice}
					{@const isPrimary = typedChoice !== 'off' && typedChoice === form.language}
					{@const selected = !isPrimary && currentSecondary() === typedChoice}
					{@const label = LANGUAGE_LABEL[typedChoice]}
					<div class="flex items-center justify-between gap-6 py-4" class:opacity-40={isPrimary}>
						<dt>
							<label
								class="flex items-center gap-3"
								class:cursor-pointer={!isPrimary}
								class:cursor-not-allowed={isPrimary}
							>
								<input
									type="radio"
									name="secondary-language"
									class="peer sr-only"
									value={typedChoice}
									checked={selected}
									disabled={isPrimary}
									onchange={() => setSecondary(typedChoice)}
									data-testid={`secondary-${typedChoice}`}
								/>
								<span class={PIP} aria-hidden="true"></span>
								<span class="text-sm font-medium">{label}</span>
								{#if isPrimary}
									<span class="font-mono text-xs text-base-content/40">primary</span>
								{/if}
							</label>
						</dt>
						<dd>
							<span class="font-mono text-xs text-base-content/30">
								{selected ? 'on' : 'off'}
							</span>
						</dd>
					</div>
				{/each}

				<div class="flex items-center justify-between gap-6 py-4" class:opacity-40={!mixActive}>
					<dt class="text-sm">
						<label for="secondary-mix" class:cursor-pointer={mixActive}>Secondary share</label>
						<span class="ml-2 font-mono text-xs text-base-content/40 tabular-nums"
							>default {DEFAULT_SECONDARY_MIX}%</span
						>
					</dt>
					<dd class="flex flex-1 items-center gap-4 pl-8">
						<input
							id="secondary-mix"
							type="range"
							min="0"
							max="100"
							step="5"
							class="flex-1 accent-primary disabled:cursor-not-allowed"
							value={form.secondaryMix ?? 0}
							disabled={!mixActive}
							oninput={(e) => {
								const v = Number((e.target as HTMLInputElement).value);
								if (Number.isFinite(v)) form.secondaryMix = v;
							}}
							data-testid="secondary-mix"
						/>
						<span class="w-12 text-right font-mono text-sm tabular-nums">
							{form.secondaryMix ?? 0}%
						</span>
					</dd>
				</div>
			</dl>
		</section>

		<section class="space-y-6" aria-labelledby="budget-heading">
			<div class="flex items-baseline gap-4">
				<span class="font-mono text-xs text-base-content/40 tabular-nums">02</span>
				<h2 id="budget-heading" class="text-xl font-semibold tracking-tight">Passage length</h2>
			</div>
			<p class="max-w-xl text-sm text-base-content/65">
				Words per passage. Shorter means more frequent verdicts and a ledger that updates more
				often; longer means more evidence per session.
			</p>

			<dl class="divide-y divide-base-300 border-y border-base-300">
				{@render numberRow({
					id: 'passage-words',
					label: 'Passage',
					fallback: DEFAULT_PASSAGE_WORDS,
					value: form.passageWords ?? DEFAULT_PASSAGE_WORDS,
					unit: 'words',
					onInput: (words) => {
						if (words >= 1) form.passageWords = words;
					}
				})}
			</dl>
		</section>

		<section class="space-y-6" aria-labelledby="bigramcolor-heading">
			<div class="flex items-baseline gap-4">
				<span class="font-mono text-xs text-base-content/40 tabular-nums">03</span>
				<h2 id="bigramcolor-heading" class="text-xl font-semibold tracking-tight">
					Bigram difficulty coloring
				</h2>
			</div>
			<p class="max-w-xl text-sm text-base-content/65">
				Whether a passage opens with the tint on. This is only the opening state — the in-session
				toggle switches between tinting error-prone pairs, tinting draggy ones, and off, whatever
				this is set to. Only pending letters are colored, so live feedback isn't muddied.
			</p>

			<dl class="divide-y divide-base-300 border-y border-base-300">
				<div class="flex items-center justify-between gap-6 py-4">
					<dt>
						<label class="flex cursor-pointer items-center gap-3">
							<input
								type="checkbox"
								class="peer sr-only"
								checked={form.colorizeBigramDifficulty ?? false}
								onchange={(e) =>
									(form.colorizeBigramDifficulty = (e.target as HTMLInputElement).checked)}
								data-testid="bigramcolor-toggle"
							/>
							<span class={PIP} aria-hidden="true"></span>
							<span class="text-sm font-medium">Start sessions with a tint</span>
						</label>
					</dt>
					<dd>
						<span class="font-mono text-xs text-base-content/30">
							{form.colorizeBigramDifficulty ? 'on' : 'off'}
						</span>
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
