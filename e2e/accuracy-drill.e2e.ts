import { expect, test } from '@playwright/test';
import { runDiagnostic } from './fixtures';

/**
 * Accuracy drill feedback loop: mistyping a target bigram damages its chip and
 * fills the red lane; later clean occurrences of the same bigram fill the green
 * one. The two stocks are independent — repayment never shrinks the red lane,
 * and a mistake never shrinks the green.
 */
test(
	'accuracy drill: a mistake fills the red lane, clean repeats fill the green one',
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

		// Pick a target that occurs at least three times: one to break, two to repay.
		const target = targets.find((b) => passage.split(b).length - 1 >= 3);
		expect(target, 'drill text should repeat some target at least three times').toBeTruthy();
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
		const paid = page.getByTestId('debt-paid');
		const added = page.getByTestId('debt-added');
		// The mistake fills the red lane; the green lane is untouched by it.
		await expect(added).not.toHaveAttribute('aria-valuenow', '0');
		await expect(paid).toHaveAttribute('aria-valuenow', '0');
		const addedAfterMistake = Number(await added.getAttribute('aria-valuenow'));

		// Correct the miss, then type through two more clean occurrences: each one
		// pays a repeat back, and the red lane stays where the mistake left it.
		await page.keyboard.press('Backspace');
		const repaidAt = occurrences[2] + 2;
		await page.keyboard.type(passage.slice(start + 1, repaidAt));
		await expect
			.poll(async () => Number(await paid.getAttribute('aria-valuenow')))
			.toBeGreaterThan(0);
		await expect(added).toHaveAttribute('aria-valuenow', String(addedAfterMistake));

		await page.keyboard.type(passage.slice(repaidAt));
		await page.waitForURL(/\/session\/[^/]+\/summary$/);
		await expect(page.getByRole('heading', { name: 'Session summary' })).toBeVisible();
	}
);
