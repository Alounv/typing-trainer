import { expect, test } from '@playwright/test';

test('dashboard renders and its one action starts a passage', async ({ page }) => {
	await page.goto('/');
	// The landing is CTA-first: there is one action, and nothing to choose
	// between. Asserting on it is a more meaningful shape check than the h1.
	await page.getByTestId('start-session').click();
	await expect(page).toHaveURL(/\/session\/real-text$/);
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Real text');
	await expect(page.getByRole('textbox')).toBeFocused();
});

test('dashboard says so when there is no history to show', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByTestId('no-history')).toBeVisible();
	await expect(page.getByTestId('recent-sessions')).toHaveCount(0);
});
