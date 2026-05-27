import type { CorpusData, QuoteBank } from './types';
import { generateBigramDrillSequence } from './bigram-drill';
import { generateRealTextSequence } from './real-text';
import { sampleDiagnosticPassage } from './diagnostic-sampler';

type TextSpec =
	| {
			kind: 'bigram-drill';
			corpus: CorpusData;
			targetBigrams: readonly string[];
			wordCount: number;
			/** Second-language corpus for mixed drills; 0..100 share via `secondaryMix`. */
			secondaryCorpus?: CorpusData;
			secondaryMix?: number;
	  }
	| {
			kind: 'real-text';
			corpus: CorpusData;
			quoteBank: QuoteBank | undefined;
			/** Second-language bank for mixed sessions; 0..100 share via `secondaryMix`. */
			secondaryQuoteBank?: QuoteBank;
			secondaryMix?: number;
			targetLengthChars: number;
	  }
	| {
			kind: 'diagnostic';
			corpus: CorpusData;
			quoteBank: QuoteBank | undefined;
			targetChars: number;
	  };

/** Single entry for producing a text to type. Dispatches on `spec.kind`. */
export function generateText(spec: TextSpec): { text: string } {
	switch (spec.kind) {
		case 'bigram-drill':
			return generateBigramDrillSequence({
				corpus: spec.corpus,
				targetBigrams: spec.targetBigrams,
				secondaryCorpus: spec.secondaryCorpus,
				secondaryMix: spec.secondaryMix,
				options: { wordCount: spec.wordCount }
			});
		case 'real-text':
			return generateRealTextSequence({
				quoteBank: spec.quoteBank,
				secondaryQuoteBank: spec.secondaryQuoteBank,
				secondaryMix: spec.secondaryMix,
				fallbackCorpus: spec.corpus,
				options: { targetLengthChars: spec.targetLengthChars }
			});
		case 'diagnostic':
			return sampleDiagnosticPassage(spec.corpus, {
				targetChars: spec.targetChars,
				quoteBank: spec.quoteBank
			});
	}
}
