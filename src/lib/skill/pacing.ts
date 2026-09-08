import type { SessionSummary } from '../support/core';
import {
	PACING_COMPARISON_WINDOW,
	PACING_SLOW_MARGIN,
	PACING_TARGET_ERROR_RATE
} from '../support/core';

/**
 * How the typist paced one session.
 *
 * `room-to-push` is the verdict the rest of the app acts on: it is the one case
 * where the answer is *speed up*, so it is what flips the in-session tint from
 * error-prone pairs to draggy ones.
 */
export type PacingVerdict = 'well-paced' | 'room-to-push' | 'too-fast';

/**
 * Only the scalar fields — no aggregates. Both `SessionSummary` and a raw
 * `StoredSession` row satisfy it, so callers that just want the verdict need
 * not decode keystroke streams to get it.
 */
export type PacingInput = Pick<SessionSummary, 'id' | 'timestamp' | 'type' | 'wpm' | 'errorRate'>;

export interface PacingAssessment {
	verdict: PacingVerdict;
	errorRate: number;
	wpm: number;
	/** Mean WPM of the comparison window; `undefined` when there is no history. */
	recentWpm: number | undefined;
}

/**
 * Accuracy is checked first, then pace:
 *
 *                            errors > 5%    errors <= 5%
 *   clearly under pace       too-fast       room-to-push
 *   at or near pace          too-fast       well-paced
 *
 * Past 5% the pace is wrong however fast it was, so speed is not consulted.
 * Under it, accuracy has been paid for and the only question left is whether
 * the speed was collected — which is what being clearly slower than usual
 * says.
 *
 * What this deliberately cannot tell apart: being timid and being tired look
 * identical from here — both are slow with accuracy to spare. So the verdict
 * reports the observation and `progress/pacingDisplay` hands the call to the
 * typist rather than asserting a diagnosis the data does not support. Acting
 * on it is cheap either way: pushing on an off day produces errors, and the
 * next session says `too-fast`.
 *
 * `history` may include `session` itself — it is excluded by id — and needs no
 * particular order.
 */
export function assessPacing(
	session: PacingInput,
	history: readonly PacingInput[] = []
): PacingAssessment {
	const recentWpm = recentAverageWpm(session, history);
	// No baseline yet: with nothing to be slower than, a first session must not
	// read as leaving speed on the table. Errors alone then decide.
	const clearlySlow = recentWpm !== undefined && session.wpm < recentWpm * (1 - PACING_SLOW_MARGIN);

	return {
		verdict: verdictFor(session.errorRate, clearlySlow),
		errorRate: session.errorRate,
		wpm: session.wpm,
		recentWpm
	};
}

function verdictFor(errorRate: number, clearlySlow: boolean): PacingVerdict {
	if (errorRate > PACING_TARGET_ERROR_RATE) return 'too-fast';
	return clearlySlow ? 'room-to-push' : 'well-paced';
}

function recentAverageWpm(
	session: PacingInput,
	history: readonly PacingInput[]
): number | undefined {
	const comparable = history
		.filter(
			(s) => s.id !== session.id && s.type === session.type && s.timestamp < session.timestamp
		)
		.sort((a, b) => b.timestamp - a.timestamp)
		.slice(0, PACING_COMPARISON_WINDOW);

	if (comparable.length === 0) return undefined;
	return comparable.reduce((sum, s) => sum + s.wpm, 0) / comparable.length;
}
