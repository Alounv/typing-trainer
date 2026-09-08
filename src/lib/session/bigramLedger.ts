import { BIGRAM_CLASSIFICATION_WINDOW, type KeystrokeEvent } from '../support/core';

/**
 * Live per-bigram debt ledger for accuracy drills. Mistyping a bigram puts it
 * {@link DEFAULT_DAMAGE} repayments in debt; only later clean occurrences pay
 * it down. Targets can start the drill already in debt — `skill/debt` reads
 * what their history still owes.
 *
 * The drill reports two stocks rather than their difference: repeats paid off
 * and repeats added. Both only grow, so a bad patch never erases the clean work
 * that came before it.
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
	/** Repeats paid off this drill. Only ever grows — clean work is never taken back. */
	repaid: number;
	/**
	 * Repeats mistakes have added this drill. A mistake adds the *difference* it
	 * makes: erring on a bigram already owing 15 takes it back to 20 and adds 5,
	 * not 20. Only ever grows.
	 */
	added: number;
	/** Full-lane value for both stocks: the most this drill could pay back. */
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
	private readonly scale: number;
	private debtAtStart = 0;
	private repaid = 0;
	private added = 0;

	constructor({ text, targetBigrams, initialDebt, damage = DEFAULT_DAMAGE }: LedgerInput) {
		this.text = text;
		this.damage = damage;
		let occurrences = 0;
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
			occurrences += this.entries.get(bigram)!.total;
		}
		// A clean occurrence pays at most one repeat, so the drill can never pay
		// back more than it contains. `damage` keeps the lanes sane when nothing
		// is owed on arrival and the only movement can be a mistake.
		this.scale = Math.max(Math.min(this.debtAtStart, occurrences), damage);
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
			this.added += this.damage - entry.debt;
			entry.debt = this.damage;
			entry.wasDamaged = true;
			return;
		}

		if (!entry) return;
		entry.cleanHits++;
		if (entry.debt > 0) {
			entry.debt--;
			this.repaid++;
		}
	}

	snapshot(): LedgerSnapshot {
		return {
			entries: [...this.entries.values()].map((e) => ({ ...e })),
			repaid: this.repaid,
			added: this.added,
			scale: this.scale
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
