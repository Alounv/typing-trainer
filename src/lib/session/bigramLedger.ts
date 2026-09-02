import { BIGRAM_CLASSIFICATION_WINDOW, type KeystrokeEvent } from '../support/core';

/**
 * Live per-bigram debt ledger for accuracy drills. Mistyping a target bigram
 * puts it {@link DEFAULT_DAMAGE} repayments in debt; only later clean
 * occurrences pay it down. Targets can start the drill already in debt —
 * `skill/debt` reads what their history still owes.
 *
 * Attribution matches `skill/extraction.ts`: the bigram at position `p` is
 * `text[p - 1] + text[p]`, charged on the right-hand character.
 */

/**
 * Clean repetitions owed after one mistake, taken from the app's own definition
 * of clean rather than picked: `classifyBigram` wants `errorRate < 0.05` over the
 * last {@link BIGRAM_CLASSIFICATION_WINDOW} samples, and one error in a
 * twenty-sample window sits exactly on 0.05. The mistake has to leave the window
 * entirely, which takes a full window of clean occurrences.
 */
export const DEFAULT_DAMAGE = BIGRAM_CLASSIFICATION_WINDOW;

export interface LedgerEntry {
	bigram: string;
	/** Clean repetitions still owed. 0 = clean. */
	debt: number;
	wasDamaged: boolean;
	cleanHits: number;
	/** Occurrences of this bigram in the drill text. */
	total: number;
}

export interface LedgerSnapshot {
	entries: LedgerEntry[];
	/** `cleanHits - damage × mistakes`. Goes negative — mistakes outrun repayment. */
	credit: number;
	creditTotal: number;
}

interface LedgerInput {
	text: string;
	targetBigrams: readonly string[];
	/** Repeats already owed when the drill starts, from the bigram's history. */
	initialDebt?: ReadonlyMap<string, number>;
	damage?: number;
}

export class BigramLedger {
	private readonly text: string;
	private readonly damage: number;
	private readonly entries = new Map<string, LedgerEntry>();
	/** Correctness of the *first* input at each position — retypes are ignored. */
	private readonly firstInputs = new Map<number, boolean>();
	private cleanHits = 0;
	private mistakes = 0;
	private creditTotal = 0;

	constructor({ text, targetBigrams, initialDebt, damage = DEFAULT_DAMAGE }: LedgerInput) {
		this.text = text;
		this.damage = damage;
		for (const bigram of targetBigrams) {
			if (this.entries.has(bigram)) continue;
			const total = countOccurrences(text, bigram);
			const debt = Math.min(damage, Math.max(0, initialDebt?.get(bigram) ?? 0));
			this.entries.set(bigram, { bigram, debt, wasDamaged: debt > 0, cleanHits: 0, total });
			this.creditTotal += total;
		}
	}

	/** Feed every keystroke, retypes included — only first inputs count. */
	record(event: KeystrokeEvent): void {
		const { position } = event;
		if (this.firstInputs.has(position)) return;
		const correct = event.actual === event.expected;
		this.firstInputs.set(position, correct);

		// One fumble is one mistake: skip wrongs that follow a wrong.
		if (!correct && this.firstInputs.get(position - 1) === false) return;

		if (position === 0) {
			if (!correct) this.mistakes++;
			return;
		}

		const entry = this.entries.get(this.text[position - 1] + this.text[position]);

		if (!correct) {
			this.mistakes++;
			if (entry) {
				entry.debt = this.damage;
				entry.wasDamaged = true;
			}
			return;
		}

		if (!entry) return;
		entry.cleanHits++;
		if (entry.debt > 0) entry.debt--;
		this.cleanHits++;
	}

	snapshot(): LedgerSnapshot {
		return {
			entries: [...this.entries.values()].map((e) => ({ ...e })),
			credit: this.cleanHits - this.damage * this.mistakes,
			creditTotal: this.creditTotal
		};
	}
}

/** Overlapping occurrences — "aaa" contains "aa" twice. */
function countOccurrences(text: string, bigram: string): number {
	if (bigram.length === 0) return 0;
	let count = 0;
	for (let i = text.indexOf(bigram); i !== -1; i = text.indexOf(bigram, i + 1)) count++;
	return count;
}
