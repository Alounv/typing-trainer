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
import { db, SINGLETON_ID } from '$lib/storage';
import { DEFAULT_SPEED_THRESHOLD_MS, DEFAULT_HIGH_ERROR_THRESHOLD } from '$lib/skill';
import type { UserSettings } from '$lib/core';
import {
	DEFAULT_BIGRAM_DRILL_WORD_BUDGET,
	DEFAULT_REAL_TEXT_WORD_BUDGET,
	DEFAULT_DIAGNOSTIC_WORD_BUDGET
} from './defaults';

/**
 * Factory-fresh profile. Function (not a const) so each caller gets a new
 * object — avoids accidental shared-reference mutation bleeding between
 * callers (e.g. reset + auto-save firing back-to-back on the settings page).
 */
export function buildDefaultProfile(): UserSettings {
	return {
		languages: ['en'],
		corpusIds: ['en'],
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
 * Merge a stored profile over defaults. Legacy profiles written before
 * `wordBudgets` / `thresholds` existed still render sane values instead of
 * `undefined` in the UI — missing leaves fall back to the factory values.
 */
export function withDefaults(stored: UserSettings): UserSettings {
	const defaults = buildDefaultProfile();
	return {
		...defaults,
		...stored,
		thresholds: { ...defaults.thresholds!, ...(stored.thresholds ?? {}) },
		wordBudgets: { ...defaults.wordBudgets!, ...(stored.wordBudgets ?? {}) }
	};
}

/**
 * Raw profile as stored. `undefined` before first save (pre-onboarding) —
 * preserved so callers that care about that distinction (e.g. "is this a
 * fresh user?") can still detect it.
 */
export async function getProfile(): Promise<UserSettings | undefined> {
	const record = await db.profile.get(SINGLETON_ID);
	return record?.settings;
}

export async function saveProfile(settings: UserSettings): Promise<void> {
	await db.profile.put({ id: SINGLETON_ID, settings });
}
