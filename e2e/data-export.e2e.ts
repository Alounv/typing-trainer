import { expect, test } from '@playwright/test';
import { runDiagnostic } from './fixtures';

/**
 * Counterpart to `data-import.e2e.ts`. Seeds one diagnostic session so there
 * is something to export, clicks the export button, intercepts the triggered
 * download, parses the JSON, and asserts the wire shape. Guards against a
 * regression in `exportAll` that would silently ship a malformed payload —
 * something import tests can't catch because they never produce a payload.
 */

test('data export: downloaded JSON round-trips through the same shape import accepts', async ({
	page
}) => {
	await runDiagnostic(page);

	await page.goto('/settings');
	await expect(page.getByTestId('data-export')).toBeVisible();

	const downloadPromise = page.waitForEvent('download');
	await page.getByTestId('data-export').click();
	const download = await downloadPromise;

	expect(download.suggestedFilename()).toMatch(/^typing-trainer-export-\d{4}-\d{2}-\d{2}\.json$/);

	const stream = await download.createReadStream();
	const chunks: Buffer[] = [];
	for await (const chunk of stream) chunks.push(chunk as Buffer);
	const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));

	// Header fields: app identity + schema version so the round-trip is verifiable.
	expect(payload.app).toBe('typing-trainer');
	expect(payload.schemaVersion).toBe(1);
	expect(typeof payload.exportedAt).toBe('number');

	// The diagnostic we ran must appear in sessions + mirrored in bigramRecords.
	expect(Array.isArray(payload.data.sessions)).toBe(true);
	expect(payload.data.sessions.length).toBeGreaterThan(0);
	expect(Array.isArray(payload.data.bigramRecords)).toBe(true);
	expect(payload.data.sessions[0].type).toBe('diagnostic');
});
