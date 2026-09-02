import { describe, expect, it } from 'vitest';
import { BigramLedger, DEFAULT_DAMAGE } from './bigramLedger';
import { BIGRAM_CLASSIFICATION_WINDOW, type KeystrokeEvent } from '../support/core';

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
	it('owes a full classification window of clean repeats per mistake', () => {
		// `classifyBigram` wants errorRate < 0.05 over the last 20 samples, and
		// 1/20 is exactly 0.05 — the error has to leave the window entirely.
		expect(DEFAULT_DAMAGE).toBe(BIGRAM_CLASSIFICATION_WINDOW);
	});

	it('starts a target already in debt when its history owes repeats', () => {
		const text = 'th th th';
		const ledger = new BigramLedger({
			text,
			targetBigrams: ['th'],
			initialDebt: new Map([['th', 3]])
		});
		expect(entry(ledger, 'th').debt).toBe(3);
		expect(entry(ledger, 'th').wasDamaged).toBe(true);

		type(ledger, text, 'th th');
		expect(entry(ledger, 'th').debt).toBe(1);
	});

	it('clamps seeded debt to one full repayment window', () => {
		const ledger = new BigramLedger({
			text: 'th',
			targetBigrams: ['th'],
			initialDebt: new Map([['th', 999]])
		});
		expect(entry(ledger, 'th').debt).toBe(DEFAULT_DAMAGE);
	});

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
		const text = 'th th th th';
		const ledger = new BigramLedger({ text, targetBigrams: ['th'] });
		type(ledger, text, 't~');
		expect(entry(ledger, 'th').debt).toBe(DEFAULT_DAMAGE);
		type(ledger, text, 't~ th');
		expect(entry(ledger, 'th').debt).toBe(DEFAULT_DAMAGE - 1);
		type(ledger, text, 't~ th th');
		expect(entry(ledger, 'th').debt).toBe(DEFAULT_DAMAGE - 2);
	});

	it('marks a bigram recovered once a full window of clean repeats is paid', () => {
		const text = 'th '.repeat(DEFAULT_DAMAGE + 1).trim();
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

	it('costs DEFAULT_DAMAGE credit per mistake and goes negative', () => {
		const text = 'th th th th th th';
		const ledger = new BigramLedger({ text, targetBigrams: ['th'] });
		type(ledger, text, 'th th th th th t~');
		expect(ledger.snapshot().credit).toBe(5 - DEFAULT_DAMAGE);

		const early = new BigramLedger({ text, targetBigrams: ['th'] });
		type(early, text, 't~');
		expect(early.snapshot().credit).toBe(-DEFAULT_DAMAGE);
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
		expect(ledger.snapshot().credit).toBe(-DEFAULT_DAMAGE);
	});

	it('charges a mistake outside the targets to the credit meter', () => {
		const text = 'th th th th th th ab';
		const ledger = new BigramLedger({ text, targetBigrams: ['th'] });
		type(ledger, text, 'th th th th th th a~');
		expect(entry(ledger, 'th').debt).toBe(0);
		expect(ledger.snapshot().credit).toBe(6 - DEFAULT_DAMAGE);
	});
});
