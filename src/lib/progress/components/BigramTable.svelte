<!-- Sortable bigram table. Default sort matches diagnostic priority-list criterion (priorityScore desc). -->
<script lang="ts">
	import type { BigramSummary } from '../metrics';
	import type { BigramClassification } from '../../support/core';
	import BigramSparkline from './BigramSparkline.svelte';

	interface Props {
		rows: BigramSummary[];
		/**
		 * Cap on how many rows to render after sorting. The bigram set can be
		 * large (an English diagnostic surfaces 250+ bigrams); beyond the
		 * top-worst-50, the long tail is mostly single-occurrence noise that
		 * crowds the table without informing action.
		 */
		limit?: number;
	}

	let { rows, limit = 50 }: Props = $props();

	/**
	 * Render whitespace as the open-box glyph (U+2423). Bigrams involving
	 * the space character otherwise look like one-character bigrams and are
	 * impossible to distinguish from letter+invisible-char pairs.
	 */
	function visualizeBigram(b: string): string {
		return b.replace(/ /g, '\u2423');
	}

	type SortKey =
		| 'bigram'
		| 'classification'
		| 'meanTime'
		| 'errorRate'
		| 'occurrences'
		| 'priority';
	type SortDir = 'asc' | 'desc';

	let sortKey = $state<SortKey>('priority');
	let sortDir = $state<SortDir>('desc');

	/** Classification ordering for display: worst → best. Mirrors the drill
	 * prescription order in `bigram/types`. */
	const CLASS_ORDER: Record<BigramClassification, number> = {
		acquisition: 0,
		hasty: 1,
		fluency: 2,
		healthy: 3,
		unclassified: 4
	};

	const sorted = $derived.by(() => {
		const out = [...rows];
		// Sort the full set first, then slice — the cap is applied *after* the
		// current sort so changing the sort key surfaces the worst-50 of that
		// dimension (e.g. sort by errors → top-50 error-prone bigrams).
		out.sort((a, b) => {
			const dir = sortDir === 'asc' ? 1 : -1;
			switch (sortKey) {
				case 'bigram':
					return a.bigram.localeCompare(b.bigram) * dir;
				case 'classification':
					return (CLASS_ORDER[a.classification] - CLASS_ORDER[b.classification]) * dir;
				case 'meanTime': {
					// Non-finite meanTime (no clean samples) sorts last regardless of direction.
					const aFin = Number.isFinite(a.meanTime);
					const bFin = Number.isFinite(b.meanTime);
					if (!aFin && !bFin) return 0;
					if (!aFin) return 1;
					if (!bFin) return -1;
					return (a.meanTime - b.meanTime) * dir;
				}
				case 'errorRate':
					return (a.errorRate - b.errorRate) * dir;
				case 'occurrences':
					return (a.occurrences - b.occurrences) * dir;
				case 'priority':
					return (a.priorityScore - b.priorityScore) * dir;
			}
		});
		return out.slice(0, limit);
	});

	const truncated = $derived(rows.length > limit);

	function toggleSort(key: SortKey) {
		if (sortKey === key) {
			sortDir = sortDir === 'asc' ? 'desc' : 'asc';
		} else {
			sortKey = key;
			// Priority + metric columns default to descending (worst/biggest first).
			// Bigram + classification columns default to ascending (A→Z, acq→healthy).
			sortDir = key === 'bigram' || key === 'classification' ? 'asc' : 'desc';
		}
	}

	function sortIndicator(key: SortKey): string {
		if (sortKey !== key) return '';
		return sortDir === 'asc' ? ' ▲' : ' ▼';
	}

	/** DaisyUI badge class for a classification — picks a semantic color per
	 * prescription severity, not the raw classification name. */
	function badgeClass(c: BigramClassification): string {
		switch (c) {
			case 'acquisition':
				return 'badge-error';
			case 'hasty':
				return 'badge-warning';
			case 'fluency':
				return 'badge-info';
			case 'healthy':
				return 'badge-success';
			case 'unclassified':
				return 'badge-ghost';
		}
	}

	function fmtMs(v: number): string {
		return Number.isFinite(v) ? `${v.toFixed(0)} ms` : '—';
	}
	function fmtPct(v: number): string {
		return `${(v * 100).toFixed(1)}%`;
	}
</script>

{#if rows.length === 0}
	<p class="text-sm text-base-content/60">
		No bigram data yet — run a diagnostic session to populate this table.
	</p>
{:else}
	<div class="overflow-x-auto rounded-lg border border-base-300">
		<table class="table table-sm">
			<thead class="bg-base-200">
				<tr>
					<!--
						Column headers are buttons so keyboard users can sort without
						a mouse. We keep the visual styling of a table header cell by
						scoping the button to `table-sort-btn` — transparent bg, left-aligned.
					-->
					<th>
						<button type="button" class="table-sort-btn" onclick={() => toggleSort('bigram')}>
							Bigram{sortIndicator('bigram')}
						</button>
					</th>
					<th>
						<button
							type="button"
							class="table-sort-btn"
							onclick={() => toggleSort('classification')}
						>
							Class{sortIndicator('classification')}
						</button>
					</th>
					<th class="text-right">
						<button type="button" class="table-sort-btn" onclick={() => toggleSort('meanTime')}>
							Mean{sortIndicator('meanTime')}
						</button>
					</th>
					<th class="text-right">
						<button type="button" class="table-sort-btn" onclick={() => toggleSort('errorRate')}>
							Errors{sortIndicator('errorRate')}
						</button>
					</th>
					<th class="text-right">
						<button type="button" class="table-sort-btn" onclick={() => toggleSort('occurrences')}>
							Occ.{sortIndicator('occurrences')}
						</button>
					</th>
					<th>Trend</th>
					<th class="text-right">
						<button type="button" class="table-sort-btn" onclick={() => toggleSort('priority')}>
							Priority{sortIndicator('priority')}
						</button>
					</th>
				</tr>
			</thead>
			<tbody>
				{#each sorted as row (row.bigram)}
					<tr>
						<!-- Keep the raw bigram on `title` so power-users can still hover
						     to distinguish the visualizer glyph from a real box character. -->
						<td class="font-mono" title={row.bigram}>{visualizeBigram(row.bigram)}</td>
						<td>
							<span class="badge badge-sm {badgeClass(row.classification)}">
								{row.classification}
							</span>
						</td>
						<td class="text-right font-mono tabular-nums">{fmtMs(row.meanTime)}</td>
						<td class="text-right font-mono tabular-nums">{fmtPct(row.errorRate)}</td>
						<td class="text-right font-mono tabular-nums">{row.occurrences}</td>
						<td><BigramSparkline points={row.trend} /></td>
						<td class="text-right font-mono tabular-nums">{row.priorityScore.toFixed(2)}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
	{#if truncated}
		<p class="mt-2 text-xs text-base-content/55" data-testid="bigram-table-truncation">
			Showing the top {limit} of {rows.length}
			bigrams by the current sort. Change the sort to surface a different slice.
		</p>
	{/if}
{/if}

<style>
	/* Scoped helper: make header-cell buttons look like plain header text so
	   the sort affordance is discoverable (hover underline) without breaking
	   the DaisyUI `.table` visual rhythm. */
	.table-sort-btn {
		background: transparent;
		border: 0;
		padding: 0;
		font: inherit;
		color: inherit;
		cursor: pointer;
		text-align: inherit;
	}
	.table-sort-btn:hover {
		text-decoration: underline;
	}
</style>
