import { describe, expect, it } from 'vitest';
import {
	findGraduatedBigrams,
	isBigramGraduated,
	CONSECUTIVE_HEALTHY_SESSIONS
} from './graduation-filter';
import type { BigramAggregate, BigramClassification } from '../core/types';

function agg(classification: BigramClassification, sessionId = 's'): BigramAggregate {
	return {
		bigram: 'th',
		sessionId,
		occurrences: 15,
		meanTime: 200,
		stdTime: 10,
		errorCount: 0,
		errorRate: 0,
		classification
	};
}

describe('isBigramGraduated', () => {
	it.each`
		description                              | classifications                                      | graduated
		${'fewer than 3 aggregates → not'}       | ${['healthy', 'healthy']}                            | ${false}
		${'exactly 3 healthy → yes'}             | ${['healthy', 'healthy', 'healthy']}                 | ${true}
		${'4+ with healthy tail → yes'}          | ${['healthy', 'healthy', 'healthy', 'fluency']}      | ${true}
		${'most recent non-healthy → no'}        | ${['fluency', 'healthy', 'healthy', 'healthy']}      | ${false}
		${'second-most-recent fluency → no'}     | ${['healthy', 'fluency', 'healthy', 'healthy']}      | ${false}
		${'unclassified breaks the streak → no'} | ${['healthy', 'unclassified', 'healthy', 'healthy']} | ${false}
		${'all healthy but only 2 → no'}         | ${['healthy', 'healthy']}                            | ${false}
		${'empty history → no'}                  | ${[]}                                                | ${false}
	`(
		'$description',
		({
			classifications,
			graduated
		}: {
			classifications: BigramClassification[];
			graduated: boolean;
		}) => {
			const history = classifications.map((c, i) => agg(c, `s${i}`));
			expect(isBigramGraduated(history)).toBe(graduated);
		}
	);

	it('honors the CONSECUTIVE_HEALTHY_SESSIONS constant', () => {
		// Sanity: if the constant ever changes, the boundary in the table
		// above matches. This is a compile-time-ish guard.
		expect(CONSECUTIVE_HEALTHY_SESSIONS).toBe(3);
	});
});

describe('findGraduatedBigrams', () => {
	it('returns only graduated candidates', async () => {
		const historyMap: Record<string, BigramAggregate[]> = {
			th: [agg('healthy'), agg('healthy'), agg('healthy')],
			he: [agg('healthy'), agg('fluency'), agg('healthy')],
			er: [agg('healthy'), agg('healthy'), agg('healthy'), agg('hasty')]
		};
		const graduated = await findGraduatedBigrams(
			['th', 'he', 'er'],
			async (b) => historyMap[b] ?? []
		);
		expect(graduated).toEqual(new Set(['th', 'er']));
	});

	it('deduplicates input before probing', async () => {
		let calls = 0;
		const graduated = await findGraduatedBigrams(['th', 'th', 'th'], async () => {
			calls++;
			return [agg('healthy'), agg('healthy'), agg('healthy')];
		});
		expect(calls).toBe(1);
		expect(graduated).toEqual(new Set(['th']));
	});

	it('empty candidate set → empty result, no probes', async () => {
		let calls = 0;
		const graduated = await findGraduatedBigrams([], async () => {
			calls++;
			return [];
		});
		expect(calls).toBe(0);
		expect(graduated.size).toBe(0);
	});
});
