/**
 * Diagnostic passage generator (spec §2.5 / §2.8).
 *
 * Builds the text a diagnostic session types through. Two properties
 * matter more than length:
 *
 *  1. **Bigram coverage** — the diagnostic must surface enough bigrams
 *     (top 50 in particular) that the downstream report can classify
 *     them confidently. The spec asks for ≥15 occurrences of top-50
 *     bigrams; this is best-effort here — we bias the sampler toward
 *     those bigrams rather than hard-guaranteeing each one.
 *  2. **Stable output** — an injectable RNG lets tests pin sequences,
 *     and (future) replay of a diagnostic won't drift.
 *
 * The output piggybacks on `generateRealTextSequence`'s synth path:
 * same corpus, same biased weighted-random sampler, just a shorter
 * char target and the top-50 corpus bigrams pre-wired as
 * `targetBigrams`.
 */
import type { CorpusData, QuoteBank } from '../corpus/types';
import { generateRealTextSequence } from '../drill/real-text';

/**
 * Default target passage length. Spec §2.5 says ~500–800 keystrokes,
 * roughly 5–8 minutes of typing. 700 chars is the comfortable middle
 * — gives enough rope for top-50 coverage without dragging.
 */
export const DEFAULT_DIAGNOSTIC_CHAR_TARGET = 700;

/**
 * How many of the top corpus bigrams we explicitly bias toward.
 * Matches the "top 50" cohort the spec singles out for guaranteed
 * coverage. Higher would dilute the boost; lower would undercover.
 */
export const DIAGNOSTIC_COVERAGE_TOP_N = 50;

export interface DiagnosticSamplerOptions {
	/** Overrides the default char target (mostly for tests). */
	targetChars?: number;
	/** Overrides the "top N bigrams to bias toward" knob. */
	coverageTopN?: number;
	/** Injectable RNG so tests and replay can pin output. */
	rng?: () => number;
	/**
	 * Optional quote bank. When present, the sampler prefers real prose
	 * and only falls back to word-synth for the tail. Quote prose gives
	 * the diagnostic a more natural feel but doesn't necessarily cover
	 * top bigrams — pass `undefined` to force the synth path, which has
	 * the target-bigram boost.
	 */
	quoteBank?: QuoteBank;
}

export interface DiagnosticPassage {
	text: string;
	/** The bigrams we biased toward — handy for tests + analytics. */
	coverageTargets: string[];
	stats: {
		chars: number;
		chunks: number;
		source: 'quote-bank' | 'word-synth' | 'quote-bank-exhausted';
	};
}

/**
 * Produce a diagnostic passage from a loaded corpus. The corpus must
 * already be loaded (via `loadBuiltinCorpus`) — this function is sync
 * on purpose so routes can generate during load without additional
 * awaits.
 */
export function sampleDiagnosticPassage(
	corpus: CorpusData,
	options: DiagnosticSamplerOptions = {}
): DiagnosticPassage {
	const targetChars = options.targetChars ?? DEFAULT_DIAGNOSTIC_CHAR_TARGET;
	const topN = options.coverageTopN ?? DIAGNOSTIC_COVERAGE_TOP_N;
	const rng = options.rng;

	const coverageTargets = topBigramsByFrequency(corpus.bigramFrequencies, topN);

	const seq = generateRealTextSequence({
		quoteBank: options.quoteBank,
		fallbackCorpus: corpus,
		targetBigrams: coverageTargets,
		options: {
			targetLengthChars: targetChars,
			rng
		}
	});

	return {
		text: seq.text,
		coverageTargets,
		stats: seq.stats
	};
}

/**
 * Return the top-N bigrams from a frequency table, descending by
 * frequency. Ties broken alphabetically so output is deterministic
 * even before RNG-seeding. Exported primarily for tests; production
 * callers use {@link sampleDiagnosticPassage} directly.
 */
export function topBigramsByFrequency(
	frequencies: Readonly<Record<string, number>>,
	count: number
): string[] {
	return Object.entries(frequencies)
		.sort(([aBigram, aFreq], [bBigram, bFreq]) => {
			if (bFreq !== aFreq) return bFreq - aFreq;
			return aBigram.localeCompare(bBigram);
		})
		.slice(0, count)
		.map(([bigram]) => bigram);
}
