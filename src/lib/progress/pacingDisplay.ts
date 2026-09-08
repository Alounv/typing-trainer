import type { PacingAssessment, PacingVerdict } from '$lib/skill';

interface VerdictCopy {
	headline: string;
	/** DaisyUI semantic token. `room-to-push` borrows the speed tint's `info`
	 *  deliberately — it is the verdict that turns that tint on next session. */
	tone: 'success' | 'info' | 'error';
}

/**
 * Headline per verdict. `room-to-push` is named for the opportunity rather than
 * a fault: the data cannot tell being timid from being tired — both read as
 * slow with accuracy to spare — so it must not claim to know which.
 */
export const PACING_COPY: Record<PacingVerdict, VerdictCopy> = {
	'well-paced': {
		headline: 'Well paced',
		tone: 'success'
	},
	'room-to-push': {
		headline: 'Room to push',
		tone: 'info'
	},
	'too-fast': {
		headline: 'Too fast',
		tone: 'error'
	}
};

/** Border / background / text classes per tone, matching the milestone banner's shape. */
export const PACING_TONE_CLASSES: Record<VerdictCopy['tone'], string> = {
	success: 'border-success/40 bg-success/5 text-success',
	info: 'border-info/40 bg-info/5 text-info',
	error: 'border-error/40 bg-error/5 text-error'
};

/**
 * The sentence under the headline. Built from the assessment rather than fixed
 * per verdict so `room-to-push` can name the actual shortfall — "14% under"
 * earns a different response from "6% under", and a constant string would make
 * both sound the same.
 */
export function pacingDetail(assessment: PacingAssessment): string {
	const errorPct = (assessment.errorRate * 100).toFixed(1);

	if (assessment.verdict === 'too-fast') {
		return `${errorPct}% errors — past 5% the corrections cost more than the pace is buying. Back off.`;
	}
	if (assessment.verdict === 'room-to-push') {
		const shortfall = shortfallPct(assessment);
		const gap = shortfall === null ? 'slower than usual' : `${shortfall}% under your usual pace`;
		// The conditional clause is the app admitting the one thing it cannot
		// see. Without it this reads as a diagnosis instead of an observation.
		return `Accuracy to spare, ${gap}. If it isn't just an off day, this is where to speed up.`;
	}
	// No baseline yet — there is no "usual speed" to have matched, so don't
	// claim one.
	if (assessment.recentWpm === undefined) {
		return `${errorPct}% errors — under the 5% ceiling. A few more sessions and this can be read against your own pace.`;
	}
	return `${errorPct}% errors at your usual speed — under the 5% ceiling, with the pace to show for it.`;
}

/** How far under the recent average, as a whole percent. `null` with no baseline. */
function shortfallPct(assessment: PacingAssessment): number | null {
	if (assessment.recentWpm === undefined || assessment.recentWpm <= 0) return null;
	return Math.round((1 - assessment.wpm / assessment.recentWpm) * 100);
}
