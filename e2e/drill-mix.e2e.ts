import { expect, test, type Page } from '@playwright/test';

/**
 * Drill-mix UI: priority/exposure split surfaces on dashboard card + in-session header.
 * Seeds `sessionStorage` with a crafted `PlannedSession` — deterministic, and avoids the diagnostic
 * classifier landing every Playwright-typed bigram `healthy` (empty priority, no exposure).
 */

const HANDOFF_KEY = 'scheduler.pendingPlannedSession';

interface SeededMix {
	priority: string[];
	exposure: string[];
}

async function stashDrillPlan(page: Page, mix: SeededMix): Promise<void> {
	const planned = {
		config: {
			type: 'bigram-drill',
			wordBudget: 20,
			bigramsTargeted: [...mix.priority, ...mix.exposure],
			// Exposure backfill is accuracy-only; speed route would need its own fluency-only fixtures.
			drillMode: 'accuracy'
		},
		label: 'Accuracy drill',
		rationale: 'test',
		drillMix: mix
	};
	// sessionStorage is origin-scoped, so we must land on a page before writing.
	await page.goto('/');
	await page.evaluate(([key, value]) => sessionStorage.setItem(key, value), [
		HANDOFF_KEY,
		JSON.stringify(planned)
	] as const);
}

test('mixed drill: priority chips filled, exposure chips dashed, legend visible', async ({
	page
}) => {
	await stashDrillPlan(page, {
		priority: ['th', 'he'],
		exposure: ['an', 'in']
	});

	await page.goto('/session/accuracy-drill');

	// aria-labels carry priority/exposure distinction (sole textual surface after header removal).
	const drillList = page.getByRole('list', { name: 'Drill targets' });
	await expect(drillList.getByLabel('th, diagnosed weakness')).toBeVisible();
	await expect(drillList.getByLabel('he, diagnosed weakness')).toBeVisible();
	await expect(drillList.getByLabel('an, new bigram for exposure practice')).toBeVisible();
	await expect(drillList.getByLabel('in, new bigram for exposure practice')).toBeVisible();

	// Legend appears only for mixed lists; pin copy to catch a rename-in-one-place-only refactor.
	await expect(page.getByText(/new bigram — not enough data yet/i)).toBeVisible();
});

test('exposure-only drill: exposure-only copy, no legend (no weakness chips to contrast)', async ({
	page
}) => {
	await stashDrillPlan(page, {
		priority: [],
		exposure: ['th', 'he', 'in']
	});

	await page.goto('/session/accuracy-drill');

	const drillList = page.getByRole('list', { name: 'Drill targets' });
	// All three chips carry the exposure label.
	await expect(drillList.getByLabel('th, new bigram for exposure practice')).toBeVisible();
	await expect(drillList.getByLabel('he, new bigram for exposure practice')).toBeVisible();
	await expect(drillList.getByLabel('in, new bigram for exposure practice')).toBeVisible();
	// No priority chips exist, so no chip carries the "diagnosed weakness" label.
	await expect(drillList.getByLabel(/diagnosed weakness/)).toHaveCount(0);

	// Legend suppressed: it would claim two styles are on screen when only one is.
	// Targets the legend's "ab" sample specifically to avoid matching arbitrary prose.
	await expect(page.getByText(/diagnosed weakness ·/)).toHaveCount(0);
});
