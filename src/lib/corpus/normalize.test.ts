import { describe, expect, it } from 'vitest';
import { normalizeTypographicChars, TYPOGRAPHIC_MAP } from './normalize';

describe('normalizeTypographicChars', () => {
	// One row per mapping — adding a key without adding a row fails the table.
	it.each([
		{ label: 'left single quote', input: '\u2018hi\u2018', expected: "'hi'" },
		{ label: 'right single quote / typographic apostrophe', input: "can\u2019t", expected: "can't" },
		{ label: 'left double quote', input: '\u201Chello', expected: '"hello' },
		{ label: 'right double quote', input: 'hello\u201D', expected: 'hello"' },
		{ label: 'en dash', input: 'page 1\u20132', expected: 'page 1-2' },
		{ label: 'em dash', input: 'wait\u2014what', expected: 'wait-what' },
		{ label: 'ellipsis expands to three dots', input: 'and\u2026', expected: 'and...' },
		{ label: 'no-break space', input: 'a\u00A0b', expected: 'a b' },
		{ label: 'narrow no-break space', input: 'a\u202Fb', expected: 'a b' }
	])('maps $label', ({ input, expected }) => {
		expect(normalizeTypographicChars(input)).toBe(expected);
	});

	it('leaves pure-ASCII text untouched', () => {
		const input = "This is a plain sentence with 'quotes' and a - hyphen.";
		expect(normalizeTypographicChars(input)).toBe(input);
	});

	it('preserves French guillemets', () => {
		expect(normalizeTypographicChars('«\u00A0Bonjour\u00A0»')).toBe('« Bonjour »');
	});

	it('preserves accented letters', () => {
		const input = 'déjà vu · forêt · naïve · çà et là';
		expect(normalizeTypographicChars(input)).toBe(input);
	});

	it('is idempotent', () => {
		const input =
			"It\u2019s 09:00\u202F\u2014 she said \u201Cthanks\u201D, then trailed off\u2026";
		const once = normalizeTypographicChars(input);
		expect(normalizeTypographicChars(once)).toBe(once);
	});

	it('handles an empty string', () => {
		expect(normalizeTypographicChars('')).toBe('');
	});

	// Every replacement value must only contain characters NOT present as map
	// keys — otherwise the function wouldn't be idempotent.
	it('no replacement value contains a map key', () => {
		for (const value of Object.values(TYPOGRAPHIC_MAP)) {
			for (const ch of value) {
				expect(TYPOGRAPHIC_MAP[ch]).toBeUndefined();
			}
		}
	});
});
