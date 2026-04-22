import { describe, it, expect } from 'vitest';
import { classifyBigram, DEFAULT_THRESHOLDS } from './classification';
import type { BigramClassification } from '../core/types';

/**
 * The 4-way classification has tunable thresholds, so bugs here are silent
 * and propagate into drill selection. Table-driven tests pin every
 * boundary (exactly-at, just-over, just-under) against the defaults
 * (150ms / 0.05) and against custom thresholds.
 */

describe('classifyBigram — defaults (thresholds: 150ms / 0.05)', () => {
	it.each`
		meanTime | errorRate | expected
		${100}   | ${0}      | ${'healthy'}
		${150}   | ${0.04}   | ${'healthy'}
		${149}   | ${0.049}  | ${'healthy'}
		${100}   | ${0.1}    | ${'hasty'}
		${150}   | ${0.05}   | ${'hasty'}
		${140}   | ${0.05}   | ${'hasty'}
		${200}   | ${0}      | ${'fluency'}
		${151}   | ${0.04}   | ${'fluency'}
		${250}   | ${0.2}    | ${'acquisition'}
		${151}   | ${0.05}   | ${'acquisition'}
	`(
		'$meanTime ms / $errorRate → $expected',
		({
			meanTime,
			errorRate,
			expected
		}: {
			meanTime: number;
			errorRate: number;
			expected: BigramClassification;
		}) => {
			expect(classifyBigram({ occurrences: 20, meanTime, errorRate })).toBe(expected);
		}
	);
});

describe('classifyBigram — insufficient data', () => {
	it.each`
		label                             | occurrences | meanTime    | errorRate
		${'below minimum occurrences'}    | ${9}        | ${50}       | ${0}
		${'zero occurrences'}             | ${0}        | ${0}        | ${0}
		${'NaN meanTime (no clean pair)'} | ${20}       | ${NaN}      | ${0.5}
		${'Infinity meanTime'}            | ${20}       | ${Infinity} | ${0}
	`(
		'returns unclassified: $label',
		({
			occurrences,
			meanTime,
			errorRate
		}: {
			occurrences: number;
			meanTime: number;
			errorRate: number;
		}) => {
			expect(classifyBigram({ occurrences, meanTime, errorRate })).toBe('unclassified');
		}
	);

	it('starts classifying at exactly 10 occurrences', () => {
		expect(classifyBigram({ occurrences: 10, meanTime: 50, errorRate: 0 })).toBe('healthy');
	});
});

describe('classifyBigram — custom thresholds', () => {
	it('honors a tighter speed threshold', () => {
		// Default would say healthy at 140ms, but a 100ms ceiling flips it to fluency.
		expect(
			classifyBigram(
				{ occurrences: 20, meanTime: 140, errorRate: 0 },
				{ speedMs: 100, errorRate: 0.05 }
			)
		).toBe('fluency');
	});

	it('honors a looser error threshold', () => {
		// Default would flag 0.08 as hasty; a 0.10 threshold tolerates it.
		expect(
			classifyBigram(
				{ occurrences: 20, meanTime: 100, errorRate: 0.08 },
				{ speedMs: DEFAULT_THRESHOLDS.speedMs, errorRate: 0.1 }
			)
		).toBe('healthy');
	});
});
