<script lang="ts">
	/**
	 * Theme picker. Full daisyUI theme list plus a "System" option.
	 *
	 * Rendered as a `<select>` rather than a custom dropdown: native
	 * controls are keyboard-accessible for free, work on mobile, and the
	 * 30+ options list makes a custom panel painful to navigate anyway.
	 * Visual treatment is just daisyUI's `select` class.
	 *
	 * The select is uncontrolled from Svelte's POV (no bind:value) because
	 * the theme store is the source of truth — we read from it on change
	 * and let the store's reactivity drive `selected`.
	 */
	import { onMount } from 'svelte';
	import { THEMES, setTheme, themeStore, type ThemeChoice } from '$lib/stores/theme.svelte';

	let mounted = $state(false);
	onMount(() => {
		mounted = true;
	});

	function onChange(e: Event) {
		const target = e.target as HTMLSelectElement;
		setTheme(target.value as ThemeChoice);
	}

	// Capitalize for display — daisyUI theme names ship lowercase and we
	// want "Cupcake" not "cupcake" in the dropdown.
	function label(name: string): string {
		return name.charAt(0).toUpperCase() + name.slice(1);
	}
</script>

<label class="flex items-center gap-2 text-sm">
	<span class="sr-only">Theme</span>
	<!--
		`suppressHydrationWarning`-style workaround: during SSR we don't
		know the user's choice (it's in localStorage). We render the
		default and let the store sync it after mount. The `disabled`
		state during pre-mount avoids a flash where "System" looks
		selected but a click does nothing.
	-->
	<select
		class="select w-auto select-ghost select-sm font-sans"
		aria-label="Choose theme"
		value={themeStore.choice}
		onchange={onChange}
		disabled={!mounted}
	>
		<!--
			Brand: the curated "core" offering — follows-OS + the three themes
			we actively steward. daisyUI group is everything else, surfaced
			for variety but not part of the brand set.
		-->
		<optgroup label="Brand">
			<option value="system">System</option>
			<option value="light">Light</option>
			<option value="dark">Dark</option>
		</optgroup>
		<optgroup label="daisyUI">
			{#each THEMES.filter((t) => t !== 'light' && t !== 'dark') as name (name)}
				<option value={name}>{label(name)}</option>
			{/each}
		</optgroup>
	</select>
</label>
