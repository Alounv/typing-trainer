/**
 * Word coordinates per position, precomputed so the keystroke hot path does no
 * scanning and a replayed event lands on the same coordinates live capture saw.
 *
 *   text:             t  h  e  ␣  c  a  t  ␣  s  a  t
 *   wordIndex:        0  0  0  0  1  1  1  1  2  2  2
 *   positionInWord:   0  1  2  3  0  1  2  3  0  1  2
 *
 * Spaces take the previous word's index; the next non-space opens a new word
 * at `positionInWord` 0.
 */
interface WordIndex {
	wordIndexByPosition: readonly number[];
	positionInWordByPosition: readonly number[];
}

export function buildWordIndex(text: string): WordIndex {
	const wordIndexByPosition: number[] = [];
	const positionInWordByPosition: number[] = [];
	let wordIdx = 0;
	let posInWord = 0;
	for (let i = 0; i < text.length; i++) {
		wordIndexByPosition.push(wordIdx);
		positionInWordByPosition.push(posInWord);
		if (text[i] === ' ') {
			wordIdx++;
			posInWord = 0;
		} else {
			posInWord++;
		}
	}
	return { wordIndexByPosition, positionInWordByPosition };
}
