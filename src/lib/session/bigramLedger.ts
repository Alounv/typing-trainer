import type { KeystrokeEvent } from '../support/core';

/**
 * Live per-bigram debt ledger for accuracy drills. Mistyping a target bigram
 * puts it `damage` repayments in debt; only later clean occurrences pay it
 * down, so a mistake costs 4 where a clean hit earns 1.
 *
 * Attribution matches `skill/extraction.ts`: the bigram at position `p` is
 * `text[p - 1] + text[p]`, charged on the right-hand character.
 */

/** Clean repetitions owed after one mistake on a bigram. */
export const DEFAULT_DAMAGE = 4;

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
	/** `cleanHits - damage × mistakes`, floored at 0. */
	credit: number;
	creditTotal: number;
}

interface LedgerInput {
	text: string;
	targetBigrams: readonly string[];
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

	constructor({ text, targetBigrams, damage = DEFAULT_DAMAGE }: LedgerInput) {
		this.text = text;
		this.damage = damage;
		for (const bigram of targetBigrams) {
			if (this.entries.has(bigram)) continue;
			const total = countOccurrences(text, bigram);
			this.entries.set(bigram, { bigram, debt: 0, wasDamaged: false, cleanHits: 0, total });
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
			credit: Math.max(0, this.cleanHits - this.damage * this.mistakes),
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
