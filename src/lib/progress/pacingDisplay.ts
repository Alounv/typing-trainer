import type { PacingVerdict } from '$lib/skill';

interface VerdictCopy {
	headline: string;
	detail: string;
	/** DaisyUI semantic token. `too-careful` borrows the speed tint's `info`
	 *  deliberately — it is the verdict that turns that tint on next session. */
	tone: 'success' | 'info' | 'error';
}

/** One clear statement per verdict, and one instruction where there is one to give. */
export const PACING_COPY: Record<PacingVerdict, VerdictCopy> = {
	'well-paced': {
		headline: 'Well paced',
		detail: 'Errors between 2% and 5% — the band where speed and accuracy both improve.',
		tone: 'success'
	},
	'too-careful': {
		headline: 'Too careful',
		detail:
			'Under 2% errors and slower than usual — that is speed left unclaimed. Push the pace; a few more errors is what it costs.',
		tone: 'info'
	},
	'too-fast': {
		headline: 'Too fast',
		detail: 'Over 5% errors — corrections are costing more than the pace is buying. Back off.',
		tone: 'error'
	}
};

/** Border / background / text classes per tone, matching the milestone banner's shape. */
export const PACING_TONE_CLASSES: Record<VerdictCopy['tone'], string> = {
	success: 'border-success/40 bg-success/5 text-success',
	info: 'border-info/40 bg-info/5 text-info',
	error: 'border-error/40 bg-error/5 text-error'
};
