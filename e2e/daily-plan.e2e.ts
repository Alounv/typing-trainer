import { expect, test, type Page } from '@playwright/test';

/**
 * All three session types end-to-end: diagnostic → drill → real-text.
 * Uses dashboard override row (deterministic) — Playwright types clean enough that a planner-built plan
 * lands every bigram `healthy` and offers only real-text. Passage read from textbox aria-label.
 */

async function typeCurrentPassage(page: Page): Promise<void> {
	const textbox = page.getByRole('textbox');
	await expect(textbox).toBeVisible();
	await expect(textbox).toBeFocused();

	const passage = (await textbox.getAttribute('aria-label')) ?? '';
	expect(passage.length).toBeGreaterThan(0);

	await page.keyboard.type(passage);
	await page.waitForURL(/\/session\/[^/]+\/summary$/);
	await expect(page.getByRole('heading', { name: 'Session summary' })).toBeVisible();
}

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
