import { describe, expect, it } from 'vitest';
import { BigramLedger, DEFAULT_DAMAGE } from './bigramLedger';
import type { KeystrokeEvent } from '../support/core';

/**
 * Types `text` against `expected`, one first-input event per position.
 * A `~` in `typed` marks a wrong key at that position.
 */
function type(ledger: BigramLedger, expected: string, typed: string) {
	for (let i = 0; i < typed.length; i++) {
		ledger.record(event(i, expected[i], typed[i] === '~' ? '#' : typed[i]));
	}
}

function event(position: number, expected: string, actual: string): KeystrokeEvent {
	return {
		timestamp: position,
		expected,
		actual,
		position,
		wordIndex: 0,
		positionInWord: position
	};
}

function entry(ledger: BigramLedger, bigram: string) {
	return ledger.snapshot().entries.find((e) => e.bigram === bigram)!;
}

describe('BigramLedger', () => {
	it('counts every occurrence of each target in the text', () => {
		const ledger = new BigramLedger({ text: 'the theme', targetBigrams: ['th', 'he'] });
		expect(entry(ledger, 'th').total).toBe(2);
		expect(entry(ledger, 'he').total).toBe(2);
		expect(ledger.snapshot().creditTotal).toBe(4);
	});

	it('earns one credit per clean target occurrence', () => {
		const ledger = new BigramLedger({ text: 'the the', targetBigrams: ['th'] });
		type(ledger, 'the the', 'the the');
		expect(entry(ledger, 'th').cleanHits).toBe(2);
		expect(ledger.snapshot().credit).toBe(2);
	});

	it('puts a mistyped bigram DEFAULT_DAMAGE repeats in debt', () => {
		const ledger = new BigramLedger({ text: 'the', targetBigrams: ['th'] });
		type(ledger, 'the', 't~');
		const th = entry(ledger, 'th');
		expect(th.debt).toBe(DEFAULT_DAMAGE);
		expect(th.wasDamaged).toBe(true);
	});

	// Each step re-types from the start; already-recorded positions are ignored.
	it('pays debt down one clean occurrence at a time', () => {
		const text = 'th th th';
		const ledger = new BigramLedger({ text, targetBigrams: ['th'] });
		type(ledger, text, 't~');
		expect(entry(ledger, 'th').debt).toBe(DEFAULT_DAMAGE);
		type(ledger, text, 't~ th');
		expect(entry(ledger, 'th').debt).toBe(DEFAULT_DAMAGE - 1);
		type(ledger, text, 't~ th th');
		expect(entry(ledger, 'th').debt).toBe(DEFAULT_DAMAGE - 2);
	});

	it('marks a bigram recovered once its debt is fully repaid', () => {
		const text = 'th th th th th';
		const ledger = new BigramLedger({ text, targetBigrams: ['th'] });
		type(ledger, text, text.replace('th', 't~'));
		expect(entry(ledger, 'th').debt).toBe(0);
		expect(entry(ledger, 'th').wasDamaged).toBe(true);
	});

	it('re-damages a bigram in full when it is mistyped again', () => {
		const text = 'th th th';
		const ledger = new BigramLedger({ text, targetBigrams: ['th'] });
		type(ledger, text, 't~ th t~');
		expect(entry(ledger, 'th').debt).toBe(DEFAULT_DAMAGE);
	});

	it('costs DEFAULT_DAMAGE credit per mistake, floored at zero', () => {
		const text = 'th th th th th th';
		const ledger = new BigramLedger({ text, targetBigrams: ['th'] });
		type(ledger, text, 'th th th th th t~');
		// 5 clean hits earned, one mistake costs 4.
		expect(ledger.snapshot().credit).toBe(1);

		const early = new BigramLedger({ text, targetBigrams: ['th'] });
		type(early, text, 't~');
		expect(early.snapshot().credit).toBe(0);
	});

	it('charges a mistake on the right-hand char only', () => {
		const ledger = new BigramLedger({ text: 'the', targetBigrams: ['th', 'he'] });
		type(ledger, 'the', 'th~');
		expect(entry(ledger, 'th').debt).toBe(0);
		expect(entry(ledger, 'he').debt).toBe(DEFAULT_DAMAGE);
	});

	it('treats a fumble run as a single mistake', () => {
		const ledger = new BigramLedger({ text: 'the', targetBigrams: ['th', 'he'] });
		type(ledger, 'the', 't~~');
		expect(entry(ledger, 'th').debt).toBe(DEFAULT_DAMAGE);
		expect(entry(ledger, 'he').debt).toBe(0);
	});

	it('ignores retypes — only the first input at a position counts', () => {
		const text = 'th th';
		const ledger = new BigramLedger({ text, targetBigrams: ['th'] });
		type(ledger, text, 't~');
		ledger.record(event(1, 'h', 'h'));
		expect(entry(ledger, 'th').debt).toBe(DEFAULT_DAMAGE);
		expect(ledger.snapshot().credit).toBe(0);
	});

	it('charges a mistake outside the targets to the credit meter', () => {
		const text = 'th th th th th th ab';
		const ledger = new BigramLedger({ text, targetBigrams: ['th'] });
		type(ledger, text, 'th th th th th th a~');
		expect(entry(ledger, 'th').debt).toBe(0);
		// 6 clean hits earned, one off-target mistake still costs 4.
		expect(ledger.snapshot().credit).toBe(2);
	});
});
