/**
 * The in-session tint: which pending letters get colored, and how strongly.
 *
 * Everything comes from one read of the profile plus recent history, taken
 * when the session mounts. Both modes derive from the same summaries, so
 * flipping the toggle mid-passage is a pure recompute rather than another trip
 * through IndexedDB and every stored keystroke stream.
 */
import { assessPacing, hydrateSessions, summarizeBigrams, type BigramSummary } from '$lib/skill';
import { getRecentSessions } from '$lib/support/storage';
import { buildDefaultProfile, getProfile } from '$lib/settings';
import { RECENT_WINDOW } from '$lib/support/core';

export type DifficultyMode = 'errors' | 'speed';

export interface TintContext {
	/**
	 * Which tint the session opens with; `null` for none.
	 *
	 * Not persisted, and not a preference — it answers the last session's
	 * verdict. Only `room-to-push` means *go faster*, so only that opens on the
	 * draggy pairs (blue); every other verdict opens on the error-prone ones
	 * (yellow). The user can override it mid-session; this is just the opening
	 * position.
	 */
	opening: DifficultyMode | null;
	/** Per-bigram difficulty in [0, 1] for one mode. Sync — no further reads. */
	scores: (mode: DifficultyMode) => Map<string, number>;
}

export async function loadTintContext(): Promise<TintContext> {
	const [profile, rows] = await Promise.all([getProfile(), getRecentSessions()]);

	// Falling back to the factory profile matters: before this, a user who had
	// never opened settings got no tint despite the default being on.
	const settings = profile ?? buildDefaultProfile();
	const summaries = summarizeBigrams(hydrateSessions(rows));

	return {
		opening: openingMode(settings.colorizeBigramDifficulty ?? false, rows),
		scores: (mode) => buildDifficultyMap(summaries, mode)
	};
}

/** Reads scalar wpm / errorRate only — the verdict needs no keystroke stream. */
function openingMode(
	enabled: boolean,
	// One more than the comparison window: the newest row is the session being
	// judged, the rest are what it is judged against.
	recent: readonly Parameters<typeof assessPacing>[0][]
): DifficultyMode | null {
	if (!enabled) return null;
	const last = recent[0];
	if (!last) return 'errors';
	const window = recent.slice(0, RECENT_WINDOW + 1);
	return assessPacing(last, window).verdict === 'room-to-push' ? 'speed' : 'errors';
}

const ERROR_RATE_CEILING = 0.1;

/** Reads errorRate / meanTime off the rolling-window summary, gated by the same
 *  classifier (and therefore the same `BIGRAM_CLASSIFICATION_WINDOW` /
 *  `MIN_OCCURRENCES_FOR_CLASSIFICATION`) that the rest of the app uses.
 *
 *  Exported for the domain's own test; production reaches it via `scores`. */
export function buildDifficultyMap(
	summaries: readonly BigramSummary[],
	mode: DifficultyMode
): Map<string, number> {
	const classified = summaries.filter((s) => s.classification !== 'unclassified');
	const out = new Map<string, number>();

	if (mode === 'errors') {
		for (const s of classified) out.set(s.bigram, clamp01(s.errorRate / ERROR_RATE_CEILING));
		return out;
	}

	const ranks = percentileRanks(classified.map((s) => [s.bigram, s.meanTime]));
	for (const [bigram, rank] of ranks) {
		// Quartic curve so only the top decile pops; rank² spread the tint too widely.
		out.set(bigram, clamp01(rank ** 4));
	}
	return out;
}

/** Percentile rank in [0, 1]; highest value gets 1, lowest gets 0. */
function percentileRanks(entries: ReadonlyArray<[string, number]>): Map<string, number> {
	if (entries.length === 0) return new Map();
	if (entries.length === 1) return new Map([[entries[0][0], 0.5]]);

	const sorted = [...entries].sort((a, b) => a[1] - b[1]);
	return new Map(sorted.map(([bigram], i) => [bigram, i / (sorted.length - 1)]));
}

function clamp01(v: number): number {
	if (!Number.isFinite(v)) return 0;
	return Math.min(1, Math.max(0, v));
}

/** Lerp from faded pending color to a DaisyUI token. The relative-color
 *  step bakes the 0.45 pending alpha into the easy end so the inline
 *  override doesn't strip the fade. */
export function difficultyToColor(score: number, highlightVar: string): string {
	const s = clamp01(score);
	return `color-mix(in oklab, oklch(from currentColor l c h / 0.45) ${((1 - s) * 100).toFixed(1)}%, var(${highlightVar}) ${(s * 100).toFixed(1)}%)`;
}

/** Match the classification swatches: the pace tint targets fluency (info),
 *  the precision tint targets hasty (warning). */
export function highlightVarForMode(mode: DifficultyMode): string {
	return mode === 'speed' ? '--color-info' : '--color-warning';
}
