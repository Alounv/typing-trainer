import { BIGRAM_CLASSIFICATION_WINDOW, type KeystrokeEvent } from '../support/core';

/**
 * Live per-bigram debt ledger for accuracy drills. Mistyping a bigram puts it
 * {@link DEFAULT_DAMAGE} repayments in debt; only later clean occurrences pay
 * it down. Targets can start the drill already in debt — `skill/debt` reads
 * what their history still owes.
 *
 * The session is scored as the change in total debt, so a drill finishes ahead
 * only if it leaves less owed than it found, and a mistake costs the difference
 * it actually makes rather than a flat penalty.
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
	/**
	 * Debt owed at the start of the drill minus debt owed now. Positive means
	 * the session left the typist better off than it found them, negative
	 * worse. A mistake therefore costs the *difference* it makes: erring on a
	 * bigram already owing 15 takes it back to 20 and costs 5, not 20.
	 */
	netRepaid: number;
	/** Full-bar value for `netRepaid` in either direction. */
	scale: number;
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
	private debtAtStart = 0;

	constructor({ text, targetBigrams, initialDebt, damage = DEFAULT_DAMAGE }: LedgerInput) {
		this.text = text;
		this.damage = damage;
		for (const bigram of targetBigrams) {
			if (this.entries.has(bigram)) continue;
			const debt = Math.min(damage, Math.max(0, initialDebt?.get(bigram) ?? 0));
			this.entries.set(bigram, {
				bigram,
				debt,
				wasDamaged: debt > 0,
				cleanHits: 0,
				total: countOccurrences(text, bigram)
			});
			this.debtAtStart += debt;
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

		// No bigram closes on the first character — nothing to owe against.
		if (position === 0) return;

		const bigram = this.text[position - 1] + this.text[position];
		let entry = this.entries.get(bigram);

		if (!correct) {
			// A bigram outside the drill targets still gets tracked once it is
			// mistyped — it now owes repeats like any other.
			if (!entry) {
				entry = { bigram, debt: 0, wasDamaged: false, cleanHits: 0, total: 0 };
				this.entries.set(bigram, entry);
			}
			entry.debt = this.damage;
			entry.wasDamaged = true;
			return;
		}

		if (!entry) return;
		entry.cleanHits++;
		if (entry.debt > 0) entry.debt--;
	}

	snapshot(): LedgerSnapshot {
		const entries = [...this.entries.values()].map((e) => ({ ...e }));
		const debtNow = entries.reduce((sum, e) => sum + e.debt, 0);
		return {
			entries,
			netRepaid: this.debtAtStart - debtNow,
			// With nothing owed at the start there is no repayment to scale
			// against, so one fresh mistake fills the bar.
			scale: Math.max(this.debtAtStart, this.damage)
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
