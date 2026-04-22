/**
 * Flatten "smart" punctuation from corpus text so drills stay typable on a
 * plain keyboard. Preserves guillemets, accents, and anything not in the map.
 */

const TYPOGRAPHIC_MAP: Readonly<Record<string, string>> = {
	'\u2018': "'", // ‘ left single quote
	'\u2019': "'", // ’ right single quote / typographic apostrophe
	'\u201C': '"', // “ left double quote
	'\u201D': '"', // ” right double quote
	'\u2013': '-', // – en dash
	'\u2014': '-', // — em dash
	'\u2026': '...', // …
	'\u00A0': ' ', // no-break space
	'\u202F': ' ' // narrow no-break space
};

export function normalizeTypographicChars(text: string): string {
	let out = '';
	for (const ch of text) {
		out += TYPOGRAPHIC_MAP[ch] ?? ch;
	}
	return out;
}
