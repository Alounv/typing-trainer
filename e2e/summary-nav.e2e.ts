import { expect, test } from '@playwright/test';
import { runSession } from './fixtures';

/**
 * The summary has two ways out and both matter: straight into the next
 * passage, which is the loop the app is built around, and back to the
 * dashboard, whose recent list is the only history surface left now the
 * plan is gone.
 */
test('summary: leads into the next passage', async ({ page }) => {
	await runSession(page);

	await expect(page.getByTestId('pacing-verdict')).toBeVisible();

	await page.getByTestId('next-session').click();
	await expect(page).toHaveURL(/\/session\/real-text$/);
	// Proves the loader actually built a passage, not just that nav fired.
	await expect(page.getByRole('textbox')).toBeVisible();
});

test('summary: returns to the dashboard, where the finished session is listed', async ({
	page
}) => {
	await runSession(page);

	await page.getByTestId('back-to-practice').click();
	await expect(page).toHaveURL(/\/$/);

	const recent = page.getByTestId('recent-sessions');
	await expect(recent).toBeVisible();
	await expect(recent.getByTestId('pacing-badge')).toHaveCount(1);
	await recent.getByRole('link', { name: 'Details →' }).click();
	await expect(page).toHaveURL(/\/session\/[^/]+\/summary$/);
});
