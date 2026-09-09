import type { FrequencyTable } from './types';

/** Zipf exponent for rank → frequency approximation. Real languages sit at 1.0–1.07. */
const ZIPF_EXPONENT = 1.0;

/** Avg English word ≈ 5 chars → 4 interior + 2 boundary bigrams, so boundaries are ~1/3. */
const BOUNDARY_MASS_SHARE = 1 / 3;

/**
 * Derive `" x"` / `"x "` frequencies from a rank-ordered wordlist and merge them
 * into the shipped interior-pair table.
 *
 * The shipped JSON only has interior pairs, so without this every boundary
 * bigram falls back to corpus-min and never gets weighted properly. Word
 * frequencies are Zipf-approximated from rank — the wordlist carries order, not
 * counts — and the derived boundary mass is scaled onto the JSON's own scale so
 * the two halves of the table stay comparable.
 */
export function addBoundaryBigrams(interior: FrequencyTable, rawWordlist: string): FrequencyTable {
	const boundaries: FrequencyTable = {};
	let boundaryMass = 0;
	for (const [word, freq] of Object.entries(zipfFrequencies(rawWordlist))) {
		boundaries[' ' + word[0]] = (boundaries[' ' + word[0]] ?? 0) + freq;
		const endKey = word[word.length - 1] + ' ';
		boundaries[endKey] = (boundaries[endKey] ?? 0) + freq;
		boundaryMass += 2 * freq;
	}

	const merged: FrequencyTable = { ...interior };
	if (boundaryMass === 0) return merged;

	let interiorMass = 0;
	for (const v of Object.values(interior)) interiorMass += v;
	// Calibrate onto the JSON's scale; without an anchor, fall back to raw weights.
	const scale = interiorMass > 0 ? (interiorMass * BOUNDARY_MASS_SHARE) / boundaryMass : 1;

	for (const [key, val] of Object.entries(boundaries)) {
		merged[key] = (merged[key] ?? 0) + val * scale;
	}
	return merged;
}

/** Rank → frequency over a whitespace-separated, rank-ordered wordlist.
 *  Duplicates collapse to the first occurrence's rank — they don't consume a slot. */
function zipfFrequencies(rawWordlist: string): FrequencyTable {
	const out: FrequencyTable = {};
	let rank = 1;
	for (const word of rawWordlist.split(/\s+/)) {
		if (word.length === 0 || out[word] !== undefined) continue;
		out[word] = 1 / Math.pow(rank, ZIPF_EXPONENT);
		rank++;
	}
	return out;
}
