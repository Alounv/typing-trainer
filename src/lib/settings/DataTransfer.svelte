<script lang="ts">
	/**
	 * Data export/import widget for the settings page.
	 *
	 * Export: serializes every Dexie table to a JSON file and triggers a
	 * browser download. Import: reads a user-chosen JSON file, shows a
	 * confirmation modal summarizing what's inside, then **replaces** the
	 * current DB on confirm (no merge — see `settings/data-transfer.ts` for why).
	 *
	 * After a successful import we force a full page reload. The other
	 * stores on this page (and elsewhere) already memoized the old
	 * profile / sessions at mount time; hot-swapping them reactively
	 * would need invalidation plumbing we don't have yet, and import is
	 * rare enough that a reload is the honest, bug-free path.
	 */
	import {
		exportAll,
		importAll,
		ImportValidationError,
		type ExportFile
	} from '$lib/settings/data-transfer';

	type Status =
		| { kind: 'idle' }
		| { kind: 'working'; message: string }
		| { kind: 'success'; message: string }
		| { kind: 'error'; message: string };

	let status = $state<Status>({ kind: 'idle' });

	/** Parsed + header-validated payload awaiting user confirmation. */
	let pendingImport = $state<ExportFile | null>(null);
	let confirmDialog: HTMLDialogElement | null = $state(null);
	let fileInput: HTMLInputElement | null = $state(null);

	/**
	 * `typing-trainer-export-2026-04-19.json`. Date-only resolution is
	 * intentional — timestamps in filenames read as clutter, and the
	 * header inside the file carries the exact `exportedAt` millis.
	 */
	function buildExportFilename(date: Date = new Date()): string {
		const y = date.getFullYear();
		const m = String(date.getMonth() + 1).padStart(2, '0');
		const d = String(date.getDate()).padStart(2, '0');
		return `typing-trainer-export-${y}-${m}-${d}.json`;
	}

	async function handleExport() {
		status = { kind: 'working', message: 'Preparing export…' };
		try {
			const file = await exportAll();
			const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
			const url = URL.createObjectURL(blob);
			const anchor = document.createElement('a');
			anchor.href = url;
			anchor.download = buildExportFilename();
			document.body.appendChild(anchor);
			anchor.click();
			anchor.remove();
			// Revoke after the click so the browser has time to actually start
			// the download. Immediate revoke works in most browsers but has
			// bitten Safari in the past.
			setTimeout(() => URL.revokeObjectURL(url), 1_000);
			status = { kind: 'success', message: 'Export downloaded.' };
		} catch (err) {
			status = {
				kind: 'error',
				message: err instanceof Error ? err.message : 'Export failed.'
			};
		}
	}

	function openFilePicker() {
		fileInput?.click();
	}

	async function handleFileChosen(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		// Reset the input so the user can re-pick the same file after cancelling.
		input.value = '';
		if (!file) return;

		status = { kind: 'working', message: 'Reading file…' };
		try {
			const text = await file.text();
			const parsed = JSON.parse(text) as unknown;
			// Light pre-check: we let `importAll` do the strict validation on
			// confirm, but we need a usable `ExportFile` shape here to preview
			// counts in the modal. Cast + guard.
			if (
				typeof parsed !== 'object' ||
				parsed === null ||
				!('data' in parsed) ||
				typeof (parsed as { data: unknown }).data !== 'object'
			) {
				throw new ImportValidationError('File is not a valid typing-trainer export.');
			}
			pendingImport = parsed as ExportFile;
			status = { kind: 'idle' };
			confirmDialog?.showModal();
		} catch (err) {
			pendingImport = null;
			status = {
				kind: 'error',
				message:
					err instanceof SyntaxError
						? 'File is not valid JSON.'
						: err instanceof Error
							? err.message
							: 'Could not read file.'
			};
		}
	}

	async function confirmImport() {
		if (!pendingImport) return;
		// Dexie calls IndexedDB's structured-clone on writes; Svelte's $state proxy
		// isn't cloneable (DataCloneError). Snapshot to a plain object at the boundary.
		const payload = $state.snapshot(pendingImport) as ExportFile;
		pendingImport = null;
		confirmDialog?.close();
		status = { kind: 'working', message: 'Importing…' };
		try {
			await importAll(payload);
			status = { kind: 'success', message: 'Import complete. Reloading…' };
			// Small delay so the success line is visible before reload.
			setTimeout(() => window.location.reload(), 400);
		} catch (err) {
			status = {
				kind: 'error',
				message: err instanceof Error ? err.message : 'Import failed.'
			};
		}
	}

	function cancelImport() {
		pendingImport = null;
		confirmDialog?.close();
	}

	/** Counts shown in the confirmation modal. Undefined when no pending file. */
	let pendingCounts = $derived.by(() => {
		if (!pendingImport) return null;
		const d = pendingImport.data as Partial<ExportFile['data']> | undefined;
		return {
			sessions: Array.isArray(d?.sessions) ? d.sessions.length : 0,
			bigramRecords: Array.isArray(d?.bigramRecords) ? d.bigramRecords.length : 0,
			hasProfile: d?.profile != null
		};
	});
</script>

<section class="space-y-6" aria-labelledby="data-heading">
	<div class="flex items-baseline gap-4">
		<span class="font-mono text-xs text-base-content/40 tabular-nums">04</span>
		<h2 id="data-heading" class="text-xl font-semibold tracking-tight">Data</h2>
	</div>
	<p class="max-w-xl text-sm text-base-content/65">
		Download every session and setting as a JSON file, or restore from one. Imports <strong
			>replace</strong
		> your current data — they don't merge.
	</p>

	<div class="flex flex-wrap items-center gap-4 border-y border-base-300 py-4">
		<button
			type="button"
			class="text-sm text-base-content/70 underline-offset-4 hover:text-base-content hover:underline disabled:pointer-events-none disabled:opacity-50"
			onclick={handleExport}
			disabled={status.kind === 'working'}
			data-testid="data-export"
		>
			Export data
		</button>
		<span aria-hidden="true" class="text-base-content/25">·</span>
		<button
			type="button"
			class="text-sm text-base-content/70 underline-offset-4 hover:text-base-content hover:underline disabled:pointer-events-none disabled:opacity-50"
			onclick={openFilePicker}
			disabled={status.kind === 'working'}
			data-testid="data-import"
		>
			Import data
		</button>

		<!-- Hidden input — clicked programmatically by the Import button above. -->
		<input
			bind:this={fileInput}
			type="file"
			accept="application/json,.json"
			class="hidden"
			onchange={handleFileChosen}
			data-testid="data-import-file"
		/>

		<div class="ml-auto text-sm" aria-live="polite">
			{#if status.kind === 'working'}
				<p class="font-mono text-base-content/45 tabular-nums">{status.message}</p>
			{:else if status.kind === 'success'}
				<p class="font-mono text-base-content/55 tabular-nums">{status.message}</p>
			{:else if status.kind === 'error'}
				<p class="text-error" role="alert">{status.message}</p>
			{/if}
		</div>
	</div>
</section>

<dialog bind:this={confirmDialog} class="modal" data-testid="data-import-confirm">
	<div class="modal-box max-w-md space-y-4">
		<h3 class="text-lg font-semibold">Replace your data?</h3>
		{#if pendingCounts}
			<p class="text-sm text-base-content/70">This file contains:</p>
			<ul class="space-y-1 border-y border-base-300 py-3 font-mono text-sm tabular-nums">
				<li class="flex justify-between">
					<span>Sessions</span>
					<span>{pendingCounts.sessions}</span>
				</li>
				<li class="flex justify-between">
					<span>Bigram records</span>
					<span>{pendingCounts.bigramRecords}</span>
				</li>
				<li class="flex justify-between">
					<span>Profile</span>
					<span>{pendingCounts.hasProfile ? 'yes' : 'no'}</span>
				</li>
			</ul>
			<p class="text-sm text-error">
				Your existing sessions, bigram history, and settings will be permanently replaced.
			</p>
		{/if}
		<div class="flex justify-end gap-4 pt-2">
			<button
				type="button"
				class="text-sm text-base-content/55 underline-offset-4 hover:text-base-content hover:underline"
				onclick={cancelImport}
				data-testid="data-import-cancel"
			>
				Cancel
			</button>
			<button
				type="button"
				class="btn btn-sm btn-error"
				onclick={confirmImport}
				data-testid="data-import-confirm-button"
			>
				Replace
			</button>
		</div>
	</div>
	<form method="dialog" class="modal-backdrop">
		<!-- Click-outside-to-close, backed by the native <dialog> form. -->
		<button type="submit" aria-label="Close">close</button>
	</form>
</dialog>
