import type { SessionSummary } from '../support/core';
import {
	CHARS_PER_WORD,
	ERROR_TIME_BUDGET_MS,
	PACING_SLOW_MARGIN,
	PACING_TARGET_ERROR_RATE,
	RECENT_WINDOW
} from '../support/core';

/** `room-to-push` is the one the app acts on — it flips the in-session tint
 *  from error-prone pairs to draggy ones. */
export type PacingVerdict = 'well-paced' | 'room-to-push' | 'too-fast';

/** Scalars only, so a caller that wants the verdict need not decode a stream. */
export type PacingInput = Pick<SessionSummary, 'id' | 'timestamp' | 'type' | 'wpm' | 'errorRate'>;

export interface PacingAssessment {
	verdict: PacingVerdict;
	errorRate: number;
	/** As recorded: prompt length over wall-clock, correction time included. */
	wpm: number;
	/** {@link wpm} with the estimated correction time taken back out. */
	cleanWpm: number;
	/** Mean {@link cleanWpm} of the comparison window; `undefined` with no history. */
	recentCleanWpm: number | undefined;
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
 * "Slower" means slower *between corrections*. Stored WPM divides the prompt
 * by wall-clock, so every correction is charged to speed: at 150ms per
 * character, going from 2% errors to 4% costs 6.9% of WPM with the fingers
 * moving at exactly the same rate. That clears the 5% margin on its own, and
 * the verdict would then tell a typist who simply made more mistakes to speed
 * up. Charging the errors back out first is what keeps the two axes separate.
 *
 * Timid and tired look identical from here, so the wording stops at the
 * observation rather than claiming a diagnosis. `history` may include
 * `session` itself — excluded by id — and needs no particular order.
 */
export function assessPacing(
	session: PacingInput,
	history: readonly PacingInput[] = []
): PacingAssessment {
	const cleanWpm = correctedWpm(session);
	const recentCleanWpm = recentAverageCleanWpm(session, history);
	// No baseline yet: with nothing to be slower than, a first session must not
	// read as leaving speed on the table. Errors alone then decide.
	const clearlySlow =
		recentCleanWpm !== undefined && cleanWpm < recentCleanWpm * (1 - PACING_SLOW_MARGIN);

	return {
		verdict: verdictFor(session.errorRate, clearlySlow),
		errorRate: session.errorRate,
		wpm: session.wpm,
		cleanWpm,
		recentCleanWpm
	};
}

/** Milliseconds per character at a given WPM. */
const MS_PER_CHAR = 60_000 / CHARS_PER_WORD;

/**
 * At most this share of a session's time may be credited to corrections. The
 * estimate is `errorRate × ERROR_TIME_BUDGET_MS`, which is a declared cost
 * rather than a measured one, so on a session that was mostly mistakes it can
 * exceed the time actually spent and drive the clean interval negative.
 */
const MAX_CORRECTION_SHARE = 0.75;

/** Observed pace with the estimated correction time charged back out. */
function correctedWpm(input: PacingInput): number {
	if (input.wpm <= 0) return 0;
	const observedMs = MS_PER_CHAR / input.wpm;
	const correctionMs = Math.min(
		input.errorRate * ERROR_TIME_BUDGET_MS,
		observedMs * MAX_CORRECTION_SHARE
	);
	return MS_PER_CHAR / (observedMs - correctionMs);
}

function verdictFor(errorRate: number, clearlySlow: boolean): PacingVerdict {
	if (errorRate > PACING_TARGET_ERROR_RATE) return 'too-fast';
	return clearlySlow ? 'room-to-push' : 'well-paced';
}

function recentAverageCleanWpm(
	session: PacingInput,
	history: readonly PacingInput[]
): number | undefined {
	const comparable = history
		.filter(
			(s) => s.id !== session.id && s.type === session.type && s.timestamp < session.timestamp
		)
		.sort((a, b) => b.timestamp - a.timestamp)
		.slice(0, RECENT_WINDOW);

	if (comparable.length === 0) return undefined;
	return comparable.reduce((sum, s) => sum + correctedWpm(s), 0) / comparable.length;
}
