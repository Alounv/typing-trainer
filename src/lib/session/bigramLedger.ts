import { BIGRAM_CLASSIFICATION_WINDOW, type KeystrokeEvent } from '../support/core';

/**
 * Live per-bigram debt ledger for accuracy drills. Mistyping a bigram puts it
 * {@link DEFAULT_DAMAGE} repeats in debt; only later clean occurrences pay it
 * down. Targets can start the drill already in debt — `skill/debt` reads what
 * their history still owes.
 *
 * The drill is scored as a finish line rather than a balance: `paid` is what
 * has been cleared and only grows, and a mistake moves `target` further out
 * instead of taking anything back. The line moves by what is still *reachable*
 * — repeats the remaining text can actually deliver — so every drill stays
 * winnable. The bigram's real debt still takes the full hit; that is what the
 * next session inherits.
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
	/** Clean repetitions still owed, carried to the next session. 0 = clean. */
	debt: number;
	wasDamaged: boolean;
	cleanHits: number;
	/** Occurrences of this bigram in the drill text. */
	total: number;
}

export interface LedgerSnapshot {
	entries: LedgerEntry[];
	/** Repeats cleared this drill. Only ever grows. */
	paid: number;
	/** Repeats this drill is asking for — the finish line. Only ever moves out. */
	target: number;
	/** Track length: every target occurrence in the text. Fixed for the drill. */
	scale: number;
}

interface Tracked extends LedgerEntry {
	/** Repeats this drill asks of this bigram — capped by what the text can deliver. */
	goal: number;
	/** Repeats cleared on this bigram so far. */
	cleared: number;
	/** Positions where this bigram is charged, ascending. */
	positions: number[];
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
	private readonly entries = new Map<string, Tracked>();
	/** Correctness of the *first* input at each position — retypes are ignored. */
	private readonly firstInputs = new Map<number, boolean>();
	private readonly scale: number;

	constructor({ text, targetBigrams, initialDebt, damage = DEFAULT_DAMAGE }: LedgerInput) {
		this.text = text;
		this.damage = damage;
		let scale = 0;
		for (const bigram of targetBigrams) {
			if (this.entries.has(bigram)) continue;
			const positions = chargePositions(text, bigram);
			const debt = Math.min(damage, Math.max(0, initialDebt?.get(bigram) ?? 0));
			this.entries.set(bigram, {
				bigram,
				debt,
				wasDamaged: debt > 0,
				cleanHits: 0,
				total: positions.length,
				// Asking for more than the text contains would make the drill
				// unwinnable before the first keystroke.
				goal: Math.min(debt, positions.length),
				cleared: 0,
				positions
			});
			scale += positions.length;
		}
		this.scale = scale;
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

		const entry = this.entries.get(this.text[position - 1] + this.text[position]);
		if (!entry) return;

		if (!correct) {
			entry.debt = this.damage;
			entry.wasDamaged = true;
			const reachable = entry.positions.filter((p) => p > position).length;
			// Never pulls the line back in: work already done stays done.
			entry.goal = Math.max(entry.goal, entry.cleared + Math.min(this.damage, reachable));
			return;
		}

		entry.cleanHits++;
		if (entry.debt > 0) {
			entry.debt--;
			entry.cleared++;
		}
	}

	snapshot(): LedgerSnapshot {
		const entries: LedgerEntry[] = [];
		let paid = 0;
		let target = 0;
		for (const e of this.entries.values()) {
			entries.push({
				bigram: e.bigram,
				debt: e.debt,
				wasDamaged: e.wasDamaged,
				cleanHits: e.cleanHits,
				total: e.total
			});
			paid += Math.min(e.cleared, e.goal);
			target += e.goal;
		}
		return { entries, paid, target, scale: this.scale };
	}
}

/** Positions of the right-hand char of each occurrence, ascending. Overlaps count. */
function chargePositions(text: string, bigram: string): number[] {
	const out: number[] = [];
	if (bigram.length === 0) return out;
	for (let i = text.indexOf(bigram); i !== -1; i = text.indexOf(bigram, i + 1)) {
		out.push(i + 1);
	}
	return out;
}
