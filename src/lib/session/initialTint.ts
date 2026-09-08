import { assessPacing } from '$lib/skill';
import { getRecentSessions } from '$lib/support/storage';
import { buildDefaultProfile, getProfile } from '$lib/settings';
import { PACING_COMPARISON_WINDOW } from '$lib/support/core';
import type { DifficultyMode } from './bigramDifficulty';

/**
 * Which tint a session opens with.
 *
 * Not persisted, and not a preference — it answers the last session's verdict.
 * Only `room-to-push` means *go faster*, so only that flips the tint to the
 * draggy pairs (blue); every other verdict leaves it on the error-prone ones
 * (yellow). The user can override it mid-session; this is just the opening
 * position.
 *
 * Reads scalar wpm / errorRate only, so no keystroke stream gets decoded.
 */
export async function resolveInitialTint(): Promise<DifficultyMode | null> {
	const [profile, recent] = await Promise.all([
		getProfile(),
		// One more than the comparison window: the newest row is the session
		// being judged, the rest are what it is judged against.
		getRecentSessions(PACING_COMPARISON_WINDOW + 1)
	]);

	// The setting keeps its old meaning — "do I want tinting at all" — and now
	// decides only the opening state. Turning it off no longer makes the toggle
	// inert. Falling back to the factory profile matters: before this, a user who
	// had never opened settings got no tint despite the default being on.
	const settings = profile ?? buildDefaultProfile();
	if (!settings.colorizeBigramDifficulty) return null;

	const last = recent[0];
	if (!last) return 'errors';
	return assessPacing(last, recent).verdict === 'room-to-push' ? 'speed' : 'errors';
}
