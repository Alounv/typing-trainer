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
	expect(payload.schemaVersion).toBe(2);
	expect(typeof payload.exportedAt).toBe('number');

	expect(Array.isArray(payload.data.sessions)).toBe(true);
	expect(payload.data.sessions.length).toBeGreaterThan(0);
	expect(Array.isArray(payload.data.bigramRecords)).toBe(true);

	// The session must carry its own evidence: the text typed, plus a keystroke
	// stream whose three columns line up. Typed arrays don't survive JSON, so
	// this is where a botched serialization would show up.
	const session = payload.data.sessions[0];
	expect(session.type).toBe('diagnostic');
	expect(typeof session.text).toBe('string');
	expect(session.text.length).toBeGreaterThan(0);
	expect(Array.isArray(session.stream.positions)).toBe(true);
	expect(Array.isArray(session.stream.times)).toBe(true);
	expect(session.stream.positions.length).toBe(session.stream.times.length);
	expect([...session.stream.typed].length).toBe(session.stream.positions.length);
	// Aggregates are derived on read now, so nothing derived should be in the file.
	expect(session.bigramAggregates).toBeUndefined();
});
