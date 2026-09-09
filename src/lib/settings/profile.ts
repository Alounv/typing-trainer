/** Sole owner of `UserSettings` reads and writes; routes are barred from
 *  `$lib/support/storage` by lint and come here instead. */
import { db, SINGLETON_ID } from '$lib/support/storage';
import { DEFAULT_PASSAGE_WORDS } from '$lib/support/core';
import type { Language, UserSettings } from '$lib/support/core';

/**
 * Shapes still on disk that `UserSettings` no longer describes. Everything here
 * is either translated into a current field or dropped — a stored key that is
 * merely undeclared would survive `withDefaults`, and outlive the feature that
 * wrote it in every export from here on.
 */
type LegacyProfile = Omit<UserSettings, 'language'> & {
	/** Arrays, from before the collapse to one language. */
	languages?: Language[];
	corpusIds?: string[];
	/** Per-session-type budgets, from before there was one session type. */
	wordBudgets?: { bigramDrill?: number; realText?: number; diagnostic?: number };
	planStructure?: Record<string, number>;
	thresholds?: { speedMs?: number; errorRate?: number };
};

/**
 * Factory-fresh profile. Function (not a const) so each caller gets a new
 * object — avoids accidental shared-reference mutation bleeding between
 * callers (e.g. reset + auto-save firing back-to-back on the settings page).
 */
export function buildDefaultProfile(): UserSettings {
	return {
		language: 'en',
		passageWords: DEFAULT_PASSAGE_WORDS,
		colorizeBigramDifficulty: true,
		secondaryMix: 0
	};
}

/**
 * Merge a stored profile over defaults, so a profile written before a field
 * existed renders a sane value rather than `undefined` in the UI.
 */
export function withDefaults(stored: UserSettings): UserSettings {
	return { ...buildDefaultProfile(), ...stored };
}

/** Translate a stored profile (potentially in a legacy shape) to current. */
function migrate(raw: UserSettings | LegacyProfile): UserSettings {
	const legacy = raw as LegacyProfile;
	const {
		languages,
		corpusIds: _corpusIds,
		wordBudgets,
		planStructure: _plan,
		thresholds: _thresholds,
		...rest
	} = legacy;

	return {
		...(rest as Omit<UserSettings, 'language'>),
		language: ('language' in raw && raw.language) || languages?.[0] || 'en',
		// A configured real-text budget carries over — it was the length of the
		// only session type that survived, so it is still the right number.
		passageWords: rest.passageWords ?? wordBudgets?.realText
	};
}

/**
 * Raw profile as stored. `undefined` before first save (pre-onboarding) —
 * preserved so callers that care about that distinction (e.g. "is this a
 * fresh user?") can still detect it.
 */
export async function getProfile(): Promise<UserSettings | undefined> {
	const record = await db.profile.get(SINGLETON_ID);
	return record?.settings ? migrate(record.settings) : undefined;
}

export async function saveProfile(settings: UserSettings): Promise<void> {
	await db.profile.put({ id: SINGLETON_ID, settings });
}
