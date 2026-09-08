import { expect, test } from '@playwright/test';
import { runSession } from './fixtures';

/**
 * Summary hand-off, and the round trip back to the dashboard. A completed
 * session has to be reachable again from the recent list — that list is the
 * only history surface left now the plan is gone.
 */
test('summary: next passage starts another session, and the session shows up on the dashboard', async ({
	page
}) => {
	await runSession(page);

	await expect(page.getByTestId('pacing-verdict')).toBeVisible();

	await page.getByTestId('next-session').click();
	await expect(page).toHaveURL(/\/session\/real-text$/);
	// Proves the loader actually built a passage, not just that nav fired.
	await expect(page.getByRole('textbox')).toBeVisible();

	await page.goto('/');
	const recent = page.getByTestId('recent-sessions');
	await expect(recent).toBeVisible();
	await expect(recent.getByTestId('pacing-badge')).toHaveCount(1);
	await recent.getByRole('link', { name: 'Details →' }).click();
	await expect(page).toHaveURL(/\/session\/[^/]+\/summary$/);
});
