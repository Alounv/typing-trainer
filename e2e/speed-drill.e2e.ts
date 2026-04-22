import { expect, test } from '@playwright/test';
import { runDiagnostic } from './fixtures';

/**
 * Speed drill differs from accuracy drill by rendering a pacer ghost — an
 * overlay whose position is driven by the prior diagnostic's baseline WPM.
 * A drill with no prior diagnostic hides the ghost, so we run a diagnostic
 * first, then navigate to speed-drill and assert the ghost shows up.
 */

test(
	'speed drill: pacer ghost renders and session persists',
	{
		annotation: { type: 'slow', description: 'diagnostic pass + speed-drill pass end-to-end' }
	},
	async ({ page }) => {
		await runDiagnostic(page);

		await page.goto('/');
		await page.getByTestId('override-speed-drill').click();
		await expect(page).toHaveURL(/\/session\/speed-drill$/);

		const textbox = page.getByRole('textbox');
		await expect(textbox).toBeVisible();
		await expect(textbox).toBeFocused();

		// Type the first char so the runner starts and the pacer clock advances —
		// the ghost only appears once elapsedMs > 0.
		const passage = (await textbox.getAttribute('aria-label')) ?? '';
		expect(passage.length).toBeGreaterThan(0);
		await page.keyboard.type(passage[0]);

		await expect(page.getByTestId('pacer-ghost')).toBeVisible();

		await page.keyboard.type(passage.slice(1));
		await page.waitForURL(/\/session\/[^/]+\/summary$/);
		await expect(page.getByRole('heading', { name: 'Session summary' })).toBeVisible();
	}
);
