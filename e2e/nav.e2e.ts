import { expect, test } from '@playwright/test';

test('dashboard renders and nav links route correctly', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Dashboard');

	await page.getByRole('link', { name: 'Drill' }).click();
	await expect(page).toHaveURL(/\/session\/bigram-drill$/);
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Bigram drill');
});
