/**
 * Theme store. Persists the user's theme choice to localStorage and keeps
 * `<html data-theme>` in sync; daisyUI reads that attribute to swap palettes
 * without a reload.
 *
 * "System" is a virtual choice: we don't store "system" as the `data-theme`
 * value (daisyUI wouldn't know what to do). Instead we store the literal
 * string "system" in localStorage and resolve it to `typewriter` (dark) or
 * `light` on apply, tracking the OS preference going forward via a
 * `matchMedia` listener.
 */

export const THEMES = [
	'light',
	'dark',
	'cupcake',
	'bumblebee',
	'emerald',
	'corporate',
	'synthwave',
	'retro',
	'cyberpunk',
	'valentine',
	'halloween',
	'garden',
	'forest',
	'aqua',
	'lofi',
	'pastel',
	'fantasy',
	'wireframe',
	'black',
	'luxury',
	'dracula',
	'cmyk',
	'autumn',
	'business',
	'acid',
	'lemonade',
	'night',
	'coffee',
	'winter',
	'dim',
	'nord',
	'sunset',
	'caramellatte',
	'abyss',
	'silk'
] as const;

export type Theme = (typeof THEMES)[number];
export type ThemeChoice = Theme | 'system';

const STORAGE_KEY = 'theme';
const DARK_FALLBACK: Theme = 'dark';
const LIGHT_FALLBACK: Theme = 'light';

/**
 * User's persisted choice. This is what the dropdown shows — the actual
 * rendered theme is `resolvedTheme` below.
 */
export const themeStore = $state<{ choice: ThemeChoice; resolved: Theme }>({
	choice: 'system',
	resolved: DARK_FALLBACK
});

/** Convert "system" into a concrete theme based on current OS preference. */
function resolveSystemTheme(): Theme {
	if (typeof window === 'undefined') return DARK_FALLBACK;
	const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
	return prefersDark ? DARK_FALLBACK : LIGHT_FALLBACK;
}

/**
 * Type guard so unfamiliar `localStorage` contents can't poison our state.
 * The old `as const` list is the source of truth.
 */
function isTheme(value: string): value is Theme {
	return (THEMES as readonly string[]).includes(value);
}

/**
 * Read persisted choice (or default to "system"), apply to DOM, start
 * tracking OS changes if needed. Call once on app mount.
 *
 * Returns a cleanup function for the OS listener — unused in practice (the
 * listener outlives the page), but honoring the contract keeps tests tidy.
 */
export function initThemeStore(): () => void {
	const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;

	if (stored === 'system' || stored === null) {
		themeStore.choice = 'system';
	} else if (isTheme(stored)) {
		themeStore.choice = stored;
	} else {
		// Corrupted value — reset quietly.
		themeStore.choice = 'system';
	}

	applyResolvedTheme();

	// When the user picks "system", follow OS changes live. If they pick an
	// explicit theme later, this handler simply no-ops.
	const mq = window.matchMedia('(prefers-color-scheme: dark)');
	const onChange = () => {
		if (themeStore.choice === 'system') applyResolvedTheme();
	};
	mq.addEventListener('change', onChange);
	return () => mq.removeEventListener('change', onChange);
}

/** Set the user's choice, persist it, and apply to the DOM. */
export function setTheme(choice: ThemeChoice): void {
	themeStore.choice = choice;
	if (typeof localStorage !== 'undefined') {
		localStorage.setItem(STORAGE_KEY, choice);
	}
	applyResolvedTheme();
}

/**
 * Resolve current `choice` → concrete theme, mutate `resolved`, and write
 * `data-theme` on `<html>`. Keeping this the single write-site means the
 * inline FOUC script (in app.html) and this module agree on semantics.
 */
function applyResolvedTheme(): void {
	const resolved =
		themeStore.choice === 'system' ? resolveSystemTheme() : themeStore.choice;
	themeStore.resolved = resolved;
	if (typeof document !== 'undefined') {
		document.documentElement.dataset.theme = resolved;
	}
}
