import { expect, test } from '@playwright/test';
import { runDiagnostic } from './fixtures';

/**
 * Accuracy drill feedback loop: mistyping a target bigram damages its chip
 * (four clean repeats owed), and later clean occurrences pay it back down to
 * a cleared chip.
 */
test(
	'accuracy drill: a mistyped bigram is damaged, then repaid',
	{ annotation: { type: 'slow', description: 'diagnostic pass + accuracy-drill pass end-to-end' } },
	async ({ page }) => {
		await runDiagnostic(page);

		await page.goto('/');
		await page.getByTestId('override-accuracy-drill').click();
		await expect(page).toHaveURL(/\/session\/accuracy-drill$/);

		const textbox = page.getByRole('textbox');
		await expect(textbox).toBeVisible();
		await expect(textbox).toBeFocused();
		const passage = (await textbox.getAttribute('aria-label')) ?? '';
		expect(passage.length).toBeGreaterThan(0);

		const chips = page.getByTestId('drill-chip');
		await expect(chips.first()).toBeVisible();
		const targets = await chips.evaluateAll((els) =>
			els.map((el) => el.getAttribute('data-bigram') ?? '')
		);

		// Pick a target that occurs at least five times: one to break, four to repay.
		const target = targets.find((b) => passage.split(b).length - 1 >= 5);
		expect(target, 'drill text should repeat some target at least five times').toBeTruthy();
		const chip = page.locator(`[data-testid="drill-chip"][data-bigram="${target}"]`);

		const occurrences: number[] = [];
		for (let i = passage.indexOf(target!); i !== -1; i = passage.indexOf(target!, i + 1)) {
			occurrences.push(i);
		}

		// Type up to (and including) the first char of the target, then miss the second.
		const start = occurrences[0];
		await page.keyboard.type(passage.slice(0, start + 1));
		await page.keyboard.type(target![1] === 'z' ? 'q' : 'z');

		await expect(chip).toHaveAttribute('data-state', 'damaged');
		await expect(chip).toHaveAttribute('data-debt', '4');
		await expect(page.getByTestId('clean-credit')).toBeVisible();

		// Correct the miss, then type through four more clean occurrences.
		await page.keyboard.press('Backspace');
		const repaid = occurrences[4] + 2;
		await page.keyboard.type(passage.slice(start + 1, repaid));
		await expect(chip).toHaveAttribute('data-state', 'recovered');
		await expect(chip).toHaveAttribute('data-debt', '0');

		await page.keyboard.type(passage.slice(repaid));
		await page.waitForURL(/\/session\/[^/]+\/summary$/);
		await expect(page.getByRole('heading', { name: 'Session summary' })).toBeVisible();
	}
);
