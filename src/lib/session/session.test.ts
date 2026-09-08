import { describe, expect, it } from 'vitest';
import { BigramLedger, DEFAULT_DAMAGE } from './bigramLedger';
import { BIGRAM_CLASSIFICATION_WINDOW, type KeystrokeEvent } from '../support/core';

/**
 * Types `typed` against `expected`, one first-input event per position.
 * A `~` in `typed` marks a wrong key there. Re-typing from the start is a no-op
 * for positions already recorded, so steps can build on each other.
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

/** `n` occurrences of "th", space-separated. Charged at positions 1, 4, 7, … */
function repeated(n: number): string {
	return 'th '.repeat(n).trim();
}

describe('BigramLedger', () => {
	it('owes a full classification window of clean repeats per mistake', () => {
		// `classifyBigram` wants errorRate < 0.05 over the last 20 samples, and
		// 1/20 is exactly 0.05 — the error has to leave the window entirely.
		expect(DEFAULT_DAMAGE).toBe(BIGRAM_CLASSIFICATION_WINDOW);
	});

	it('measures the track in target occurrences', () => {
		const ledger = new BigramLedger({ text: 'the theme', targetBigrams: ['th', 'he'] });
		expect(entry(ledger, 'th').total).toBe(2);
		expect(ledger.snapshot().scale).toBe(4);
	});

	it('asks for nothing when nothing is owed on arrival', () => {
		const text = repeated(3);
		const ledger = new BigramLedger({ text, targetBigrams: ['th'] });
		type(ledger, text, text);
		expect(ledger.snapshot()).toMatchObject({ paid: 0, target: 0 });
	});

	it('opens the drill asking for the debt the typist walked in with', () => {
		const text = repeated(6);
		const ledger = new BigramLedger({
			text,
			targetBigrams: ['th'],
			initialDebt: new Map([['th', 4]])
		});
		expect(ledger.snapshot()).toMatchObject({ paid: 0, target: 4 });

		type(ledger, text, text);
		expect(ledger.snapshot()).toMatchObject({ paid: 4, target: 4 });
	});

	it('never asks for more repeats than the text can deliver', () => {
		// Owes a full window but the drill only contains three occurrences.
		const ledger = new BigramLedger({
			text: repeated(3),
			targetBigrams: ['th'],
			initialDebt: new Map([['th', DEFAULT_DAMAGE]])
		});
		expect(ledger.snapshot().target).toBe(3);
	});

	it('moves the finish line out by what is still reachable', () => {
		const text = repeated(6);
		const ledger = new BigramLedger({ text, targetBigrams: ['th'] });
		type(ledger, text, 't~');
		// Five occurrences left after the mistake, so five repeats are asked for.
		expect(ledger.snapshot()).toMatchObject({ paid: 0, target: 5 });

		type(ledger, text, text.replace('th', 't~'));
		expect(ledger.snapshot()).toMatchObject({ paid: 5, target: 5 });
	});

	it('leaves paid work alone when the line moves', () => {
		const text = repeated(6);
		const ledger = new BigramLedger({
			text,
			targetBigrams: ['th'],
			initialDebt: new Map([['th', 3]])
		});
		type(ledger, text, 'th th');
		expect(ledger.snapshot()).toMatchObject({ paid: 2, target: 3 });

		// Erring on the third occurrence: three still reachable after it.
		type(ledger, text, 'th th t~');
		expect(ledger.snapshot()).toMatchObject({ paid: 2, target: 5 });
	});

	it('does not move the line when there is nothing left to run', () => {
		const text = repeated(6);
		const ledger = new BigramLedger({ text, targetBigrams: ['th'] });
		type(ledger, text, 'th th th th th t~');
		expect(ledger.snapshot()).toMatchObject({ paid: 0, target: 0 });
	});

	it('still charges the bigram a full window for the next session', () => {
		const text = repeated(2);
		const ledger = new BigramLedger({ text, targetBigrams: ['th'] });
		type(ledger, text, 't~');
		// The drill only asks for the one repeat it can deliver…
		expect(ledger.snapshot().target).toBe(1);
		// …but the debt carried forward is the whole window.
		expect(entry(ledger, 'th').debt).toBe(DEFAULT_DAMAGE);
	});

	it('pays debt down one clean occurrence at a time', () => {
		const text = repeated(4);
		const ledger = new BigramLedger({
			text,
			targetBigrams: ['th'],
			initialDebt: new Map([['th', DEFAULT_DAMAGE]])
		});
		type(ledger, text, 'th');
		expect(entry(ledger, 'th').debt).toBe(DEFAULT_DAMAGE - 1);
		type(ledger, text, 'th th');
		expect(entry(ledger, 'th').debt).toBe(DEFAULT_DAMAGE - 2);
	});

	it('clamps seeded debt to one full repayment window', () => {
		const ledger = new BigramLedger({
			text: repeated(1),
			targetBigrams: ['th'],
			initialDebt: new Map([['th', 999]])
		});
		expect(entry(ledger, 'th').debt).toBe(DEFAULT_DAMAGE);
	});

	it('marks a bigram recovered once its debt is fully repaid', () => {
		const text = repeated(DEFAULT_DAMAGE + 1);
		const ledger = new BigramLedger({ text, targetBigrams: ['th'] });
		type(ledger, text, text.replace('th', 't~'));
		expect(entry(ledger, 'th')).toMatchObject({ debt: 0, wasDamaged: true });
	});

	it('re-damages a bigram in full when it is mistyped again', () => {
		const text = repeated(3);
		const ledger = new BigramLedger({ text, targetBigrams: ['th'] });
		type(ledger, text, 't~ th t~');
		expect(entry(ledger, 'th').debt).toBe(DEFAULT_DAMAGE);
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
		const text = repeated(2);
		const ledger = new BigramLedger({ text, targetBigrams: ['th'] });
		type(ledger, text, 't~');
		ledger.record(event(1, 'h', 'h'));
		expect(entry(ledger, 'th').debt).toBe(DEFAULT_DAMAGE);
		expect(ledger.snapshot().paid).toBe(0);
	});

	it('ignores a mistake on a bigram the drill is not targeting', () => {
		const text = 'th ab th';
		const ledger = new BigramLedger({ text, targetBigrams: ['th'] });
		type(ledger, text, 'th a~');
		expect(ledger.snapshot()).toMatchObject({ paid: 0, target: 0 });
	});
});
