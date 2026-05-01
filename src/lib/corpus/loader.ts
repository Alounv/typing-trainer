import type { CorpusConfig, CorpusData, FrequencyTable } from './types';

/** Zipf exponent for rank → frequency approximation. Real languages sit at 1.0–1.07. */
const ZIPF_EXPONENT = 1.0;

/** Avg English word ≈ 5 chars → 4 interior + 2 boundary bigrams, so boundaries are ~1/3. */
const BOUNDARY_MASS_SHARE = 1 / 3;

/** Loads a rank-ordered wordlist (Zipf-approximated) + separate bigram table. Bigrams are separate because a top-1k wordlist under-weights mid-rank pairs and misses rare ones. */
export function loadCorpus(
	config: CorpusConfig,
	rawWordlist: string,
	bigramFrequencies: FrequencyTable = {}
): CorpusData {
	const words = tokenize(rawWordlist);
	const wordFrequencies = zipfFrequencies(words);
	return {
		config,
		wordFrequencies,
		bigramFrequencies: augmentWithBoundaryBigrams(wordFrequencies, bigramFrequencies)
	};
}

/** Derive `" x"` / `"x "` from the wordlist; shipped JSON only has interior pairs, so without
 *  this every boundary bigram falls back to corpus-min and never gets drilled. */
function augmentWithBoundaryBigrams(
	wordFrequencies: FrequencyTable,
	bigramFrequencies: FrequencyTable
): FrequencyTable {
	const boundaries: FrequencyTable = {};
	let boundaryMass = 0;
	for (const [word, freq] of Object.entries(wordFrequencies)) {
		if (word.length === 0 || freq <= 0) continue;
		const startKey = ' ' + word[0];
		const endKey = word[word.length - 1] + ' ';
		boundaries[startKey] = (boundaries[startKey] ?? 0) + freq;
		boundaries[endKey] = (boundaries[endKey] ?? 0) + freq;
		boundaryMass += 2 * freq;
	}

	const merged: FrequencyTable = { ...bigramFrequencies };
	if (boundaryMass === 0) return merged;

	let interiorMass = 0;
	for (const v of Object.values(bigramFrequencies)) interiorMass += v;
	// Calibrate onto the JSON's scale; without an anchor, fall back to raw weights.
	const scale = interiorMass > 0 ? (interiorMass * BOUNDARY_MASS_SHARE) / boundaryMass : 1;

	for (const [key, val] of Object.entries(boundaries)) {
		merged[key] = (merged[key] ?? 0) + val * scale;
	}
	return merged;
}

// Whitespace split for pre-normalized flat lists.
function tokenize(raw: string): string[] {
	return raw.split(/\s+/).filter((w) => w.length > 0);
}

function zipfFrequencies(orderedWords: string[]): FrequencyTable {
	const out: FrequencyTable = {};
	// Duplicates collapse to the first occurrence's rank — don't consume a slot.
	let rank = 1;
	for (const w of orderedWords) {
		if (out[w] !== undefined) continue;
		out[w] = 1 / Math.pow(rank, ZIPF_EXPONENT);
		rank++;
	}
	return out;
}
