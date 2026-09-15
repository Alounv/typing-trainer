import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { normalizeTypographicChars } from '../src/lib/corpus/normalize';

/**
 * The ghost is the only thing on the page driven by wall-clock rather than by
 * keystrokes, so unit tests can pin what it replays but not that it moves.
 *
 * Which quote the next passage draws is not something a test can choose, so the
 * seeded history is one run covering every quote short enough to be drawn — an
 * artificial row, but the passage that lands on top of it is the real one.
 */

const GHOST_GAP_MS = 250;

/** Matches the assembler's ceiling: 25 words × 5 chars, 50% overshoot allowed. */
const LONGEST_DRAWABLE_QUOTE = 190;

function everyDrawableQuote(): string {
	const bank = JSON.parse(
		readFileSync(new URL('../src/lib/corpus/data/english-quotes.json', import.meta.url), 'utf8')
	) as { quotes: { text: string }[] };
	return bank.quotes
		.map((q) => normalizeTypographicChars(q.text))
		.filter((text) => text.length <= LONGEST_DRAWABLE_QUOTE)
		.join(' ');
}

test('ghost pacer: replays the typist’s past run of the drawn quote', async ({ page }) => {
	// Dexie opens the database on the dashboard's first read; seeding before
	// that would land in a database with no object stores.
	await page.goto('/');
	await page.waitForFunction(async () =>
		(await indexedDB.databases()).some((d) => d.name === 'typing-trainer')
	);

	await page.evaluate(
		({ text, gapMs }) =>
			new Promise<void>((resolve, reject) => {
				const open = indexedDB.open('typing-trainer');
				open.onerror = () => reject(open.error);
				open.onsuccess = () => {
					const db = open.result;
					const tx = db.transaction('sessions', 'readwrite');
					tx.objectStore('sessions').put({
						id: 'e2e-ghost-history',
						timestamp: Date.now() - 60_000,
						type: 'real-text',
						durationMs: text.length * gapMs,
						wpm: 48,
						errorRate: 0,
						text,
						stream: {
							positions: Int16Array.from({ length: text.length }, (_, i) => (i === 0 ? 0 : 1)),
							times: Uint32Array.from({ length: text.length }, (_, i) => (i === 0 ? 0 : gapMs)),
							typed: text
						}
					});
					tx.onerror = () => reject(tx.error);
					tx.oncomplete = () => {
						db.close();
						resolve();
					};
				};
			}),
		{ text: everyDrawableQuote(), gapMs: GHOST_GAP_MS }
	);

	await page.goto('/session/real-text');
	const textbox = page.getByRole('textbox');
	await expect(textbox).toBeFocused();
	await expect(page.getByTestId('ghost-legend')).toBeVisible();

	const marker = page.getByTestId('ghost-marker');
	// Nothing to pace against until the race has a start: the ghost appears with
	// the first keystroke of the quote, not on load.
	await expect(marker).toHaveCount(0);

	const passage = (await textbox.getAttribute('aria-label')) ?? '';
	await page.keyboard.type(passage.slice(0, 6));
	await expect(marker).toBeVisible();

	// A quarter-second per character is far slower than Playwright types, so the
	// marker is still near the top of the quote — and still moving.
	await expect
		.poll(async () => Number(await marker.getAttribute('data-pos')), { timeout: 5_000 })
		.toBeGreaterThanOrEqual(4);

	await page.keyboard.type(passage.slice(6));
	await page.waitForURL(/\/session\/[^/]+\/summary$/);
});
