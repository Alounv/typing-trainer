/**
 * Profile domain — single owner of `UserSettings` reads/writes.
 *
 * Why this exists:
 * - Multiple consumers (settings page, session setup, analytics, scheduler)
 *   all need the profile with defaults applied. Keeping the defaults + merge
 *   logic here prevents each caller from reinventing — and drifting on —
 *   the "what does a factory-fresh profile look like" answer.
 * - Routes must not import `$lib/storage/*` directly; this module is the
 *   UI-facing boundary for anything profile-shaped.
 */
import { db, SINGLETON_ID } from '$lib/support/storage';
import {
	DEFAULT_SPEED_THRESHOLD_MS,
	DEFAULT_HIGH_ERROR_THRESHOLD,
	DEFAULT_PASSAGE_WORDS
} from '$lib/support/core';
import type { Language, UserSettings } from '$lib/support/core';

/**
 * Shapes written by earlier builds, migrated on read.
 *
 *   `languages` / `corpusIds`  — arrays, before the collapse to one language.
 *   `wordBudgets`              — per-session-type budgets, before there was
 *                                only one session type.
 *   `planStructure`            — the daily plan's shape, before the planner
 *                                was removed. Dropped; nothing consumes it.
 */
type LegacyProfile = Omit<UserSettings, 'language'> & {
	languages?: Language[];
	corpusIds?: string[];
	wordBudgets?: { bigramDrill?: number; realText?: number; diagnostic?: number };
	planStructure?: Record<string, number>;
};

/**
 * Factory-fresh profile. Function (not a const) so each caller gets a new
 * object — avoids accidental shared-reference mutation bleeding between
 * callers (e.g. reset + auto-save firing back-to-back on the settings page).
 */
export function buildDefaultProfile(): UserSettings {
	return {
		language: 'en',
		thresholds: {
			speedMs: DEFAULT_SPEED_THRESHOLD_MS,
			errorRate: DEFAULT_HIGH_ERROR_THRESHOLD
		},
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
	const defaults = buildDefaultProfile();
	return {
		...defaults,
		...stored,
		thresholds: { ...defaults.thresholds!, ...(stored.thresholds ?? {}) }
	};
}

/** Translate a stored profile (potentially in a legacy shape) to current. */
function migrate(raw: UserSettings | LegacyProfile): UserSettings {
	const legacy = raw as LegacyProfile;
	const { languages, corpusIds: _corpusIds, wordBudgets, planStructure: _plan, ...rest } = legacy;

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
