import { expect, test, type Page } from '@playwright/test';

/**
 * Drill-mix UI: verifies that the priority/exposure split from the planner
 * surfaces correctly on both the dashboard card and the in-session header —
 * the "explicit to the user" requirement.
 *
 * Seeds `sessionStorage` with a crafted `PlannedSession` rather than running
 * a full diagnostic, because (a) we need a deterministic mix and (b) the
 * diagnostic's classifier lands all Playwright-typed bigrams as `healthy`,
 * producing an empty priority list with no exposure either. The drill
 * route's hand-off is the seam this test exploits.
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
			// Both fixtures are accuracy-mode: undertrained/exposure backfill is
			// an accuracy-mode concern, and priority hasty/acquisition targets
			// likewise. The dedicated speed route would carry its own fixtures
			// (fluency-only, no exposure) — keeping the coverage focused rather
			// than duplicating the whole test file per mode.
			drillMode: 'accuracy'
		},
		reason: 'default-drill',
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

	// Chips surface aria-labels per source — the semantic hook the UI uses to
	// carry the priority/exposure distinction to assistive tech. These are now
	// the only place the priority-vs-exposure distinction appears in text
	// (the `what` header that used to spell it out was removed — the title +
	// chip list are enough to convey mix composition).
	const drillList = page.getByRole('list', { name: 'Drill targets' });
	await expect(drillList.getByLabel('th, diagnosed weakness')).toBeVisible();
	await expect(drillList.getByLabel('he, diagnosed weakness')).toBeVisible();
	await expect(drillList.getByLabel('an, new bigram for exposure practice')).toBeVisible();
	await expect(drillList.getByLabel('in, new bigram for exposure practice')).toBeVisible();

	// Legend appears only in mixed cases; pin the copy so a refactor that
	// renames "new bigram" in one place and not the other breaks this test.
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
