/**
 * "System" is a virtual choice: daisyUI would not know what to do with it as a
 * `data-theme` value, so it is stored as the literal string "system" and
 * resolved to `dark` or `light` on apply, tracked by a `matchMedia` listener.
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

type Theme = (typeof THEMES)[number];
export type ThemeChoice = Theme | 'system';

const STORAGE_KEY = 'theme';
const DARK_FALLBACK: Theme = 'dark';
const LIGHT_FALLBACK: Theme = 'light';

/**
 * User's persisted choice — what the dropdown shows. The theme actually
 * rendered lives on `<html data-theme>`, which is the single output; nothing
 * needs it mirrored back into state.
 */
export const themeStore = $state<{ choice: ThemeChoice }>({ choice: 'system' });

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
	// Anything that isn't a known theme — "system", absent, or corrupted —
	// falls back to following the OS.
	themeStore.choice = stored !== null && isTheme(stored) ? stored : 'system';

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
 * Resolve current `choice` → concrete theme and write `data-theme` on `<html>`.
 * Keeping this the single write-site means the inline FOUC script (in
 * app.html) and this module agree on semantics.
 */
function applyResolvedTheme(): void {
	if (typeof document === 'undefined') return;
	document.documentElement.dataset.theme =
		themeStore.choice === 'system' ? resolveSystemTheme() : themeStore.choice;
}
