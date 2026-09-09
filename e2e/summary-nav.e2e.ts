import { expect, test } from '@playwright/test';
import { runSession } from './fixtures';

/**
 * The round trip back to the dashboard. A completed session has to be
 * reachable again from the recent list — that list is the only history
 * surface left now the plan is gone. Starting the next passage is the
 * dashboard's job; the summary no longer offers it.
 */
test('summary: returns to the dashboard, where the finished session is listed', async ({
	page
}) => {
	await runSession(page);

	await expect(page.getByTestId('pacing-verdict')).toBeVisible();

	await page.getByTestId('back-to-practice').click();
	await expect(page).toHaveURL(/\/$/);
	const recent = page.getByTestId('recent-sessions');
	await expect(recent).toBeVisible();
	await expect(recent.getByTestId('pacing-badge')).toHaveCount(1);
	await recent.getByRole('link', { name: 'Details →' }).click();
	await expect(page).toHaveURL(/\/session\/[^/]+\/summary$/);
});
