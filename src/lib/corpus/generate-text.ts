import type { CorpusData, QuoteBank } from './types';
import { generateBigramDrillSequence } from './bigram-drill';
import { generateRealTextSequence } from './real-text';
import { sampleDiagnosticPassage } from './diagnostic-sampler';

export type TextSpec =
	| {
			kind: 'bigram-drill';
			corpus: CorpusData;
			targetBigrams: readonly string[];
			wordCount: number;
	  }
	| {
			kind: 'real-text';
			corpus: CorpusData;
			quoteBank: QuoteBank | undefined;
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
				options: { wordCount: spec.wordCount }
			});
		case 'real-text':
			return generateRealTextSequence({
				quoteBank: spec.quoteBank,
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
