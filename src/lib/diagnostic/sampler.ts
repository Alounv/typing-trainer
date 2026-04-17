/**
 * Diagnostic passage generator. Biases toward top-50 corpus bigrams so the
 * downstream report can classify them confidently. RNG is injectable for tests.
 * Piggybacks on `generateRealTextSequence`'s synth path with a shorter target.
 */
import type { CorpusData, QuoteBank } from '../corpus/types';
import { generateRealTextSequence } from '../drill/real-text';

/** ~5–8 min of typing; enough rope for top-50 coverage without dragging. */
export const DEFAULT_DIAGNOSTIC_CHAR_TARGET = 700;

/** How many top corpus bigrams to bias toward. Higher dilutes boost; lower undercovers. */
export const DIAGNOSTIC_COVERAGE_TOP_N = 50;

export interface DiagnosticSamplerOptions {
	/** Overrides the default char target (mostly for tests). */
	targetChars?: number;
	/** Overrides the "top N bigrams to bias toward" knob. */
	coverageTopN?: number;
	/** Injectable RNG so tests and replay can pin output. */
	rng?: () => number;
	/**
	 * Optional quote bank. When present, prefers real prose and only falls
	 * back to synth for the tail. Pass `undefined` to force the synth path
	 * (which has the target-bigram boost).
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

// Produce a diagnostic passage from a loaded corpus. Sync on purpose so
// routes can generate during load without extra awaits.
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

// Top-N bigrams by frequency, ties broken alphabetically for determinism.
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
