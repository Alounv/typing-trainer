import { expect, test } from '@playwright/test';
import { typeCurrentPassage } from './fixtures';

/**
 * All three session types end-to-end: diagnostic → drill → real-text.
 * Uses dashboard override row (deterministic) — Playwright types clean enough that a planner-built plan
 * lands every bigram `healthy` and offers only real-text. Passage read from textbox aria-label.
 */

test(
	'diagnostic → drill → real-text: each session type persists through the runner',
	{
		// ~1000-char diagnostic + three sessions of type/nav/Dexie writes exceeds the 30s default.
		annotation: { type: 'slow', description: 'types three passages end-to-end' }
	},
	async ({ page }) => {
		await page.goto('/session/diagnostic');
		await typeCurrentPassage(page);

		// Accuracy override routes straight to the drill with a fallback target-bigram set.
		await page.goto('/');
		await page.getByTestId('override-accuracy-drill').click();
		await expect(page).toHaveURL(/\/session\/accuracy-drill$/);
		await typeCurrentPassage(page);

		await page.goto('/');
		await page.getByTestId('override-realtext').click();
		await expect(page).toHaveURL(/\/session\/real-text$/);
		await typeCurrentPassage(page);
	}
);
