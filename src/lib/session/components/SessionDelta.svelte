<script lang="ts">
	/**
	 * Post-session delta card (Phase 8.1).
	 *
	 * Pure view — all interpretation happens in `delta.ts`. The job here is
	 * to lay out the sentence + three supporting metrics in a way that
	 * reads cleanly against the existing summary page (tabular mono
	 * numerics, hairline dividers, no card-shadow tell).
	 *
	 * The summary sentence is the primary surface; the three stat blocks
	 * below exist for the user who wants to drill into the numbers. We
	 * deliberately don't colour "down" verdicts red — bad-session
	 * attribution (8.2) lives on its own.
	 */
	import type { SessionDelta, MetricVerdict } from '../delta';

	interface Props {
		delta: SessionDelta;
	}

	let { delta }: Props = $props();

	/** Human-readable arrow for a metric verdict. Kept minimal — no colour. */
	function verdictGlyph(v: MetricVerdict): string {
		switch (v) {
			case 'up':
				return '↑';
			case 'down':
				return '↓';
			case 'flat':
				return '·';
			case 'first':
				return '—';
		}
	}

	/** Format a signed fractional delta like `0.042` → `+4%`. */
	function formatDeltaPct(pct: number | null): string {
		if (pct === null) return '—';
		const abs = Math.abs(pct * 100);
		const sign = pct > 0 ? '+' : pct < 0 ? '−' : '';
		return `${sign}${abs.toFixed(0)}%`;
	}
</script>

<section class="space-y-5" aria-labelledby="delta-heading" data-testid="session-delta">
	<div class="flex items-baseline gap-4">
		<span class="font-mono text-xs text-base-content/40 tabular-nums">Δ</span>
		<h2 id="delta-heading" class="text-xl font-semibold tracking-tight">How this compares</h2>
	</div>

	<!--
		Summary sentence. Emphasis-weight text so the reader lands here first;
		specific numbers are available in the stat blocks below.
	-->
	<p class="max-w-2xl text-base-content/85" data-testid="session-delta-summary">
		{delta.summarySentence}
	</p>

	<!--
		Three stat blocks in a tight row. Each one shows the raw number, a
		verdict glyph, and a small caption with the baseline comparison. Grid
		is auto-fit so the layout collapses cleanly on narrow widths.
	-->
	<dl
		class="grid gap-4 border-y border-base-300 py-4"
		style="grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));"
	>
		<!-- WPM -->
		<div class="space-y-1" data-testid="delta-wpm">
			<dt class="text-xs tracking-wide text-base-content/50 uppercase">WPM</dt>
			<dd class="flex items-baseline gap-2">
				<span class="font-mono text-2xl font-medium tabular-nums">
					{delta.wpm.current.toFixed(1)}
				</span>
				<span
					class="font-mono text-sm text-base-content/50 tabular-nums"
					aria-label={`verdict: ${delta.wpm.verdict}`}
				>
					{verdictGlyph(delta.wpm.verdict)}
				</span>
			</dd>
			<dd class="font-mono text-xs text-base-content/45 tabular-nums">
				{#if delta.wpm.verdict === 'first'}
					first session
				{:else if delta.wpm.rollingAvg !== null}
					{formatDeltaPct(delta.wpm.deltaPct)} vs {delta.wpm.rollingAvg.toFixed(1)} avg
				{/if}
			</dd>
		</div>

		<!-- Error rate / floor -->
		<div class="space-y-1" data-testid="delta-errors">
			<dt class="text-xs tracking-wide text-base-content/50 uppercase">Errors</dt>
			<dd class="flex items-baseline gap-2">
				<span class="font-mono text-2xl font-medium tabular-nums">
					{(delta.errorFloor.current * 100).toFixed(1)}%
				</span>
				<span
					class="font-mono text-sm text-base-content/50 tabular-nums"
					aria-label={`verdict: ${delta.errorRate.verdict}`}
				>
					{verdictGlyph(delta.errorRate.verdict)}
				</span>
			</dd>
			<dd class="font-mono text-xs text-base-content/45 tabular-nums">
				{#if delta.errorFloor.below}
					below {(delta.errorFloor.threshold * 100).toFixed(0)}% floor
				{:else}
					above {(delta.errorFloor.threshold * 100).toFixed(0)}% floor
				{/if}
			</dd>
		</div>

		<!-- Bigram activity -->
		<div class="space-y-1" data-testid="delta-bigrams">
			<dt class="text-xs tracking-wide text-base-content/50 uppercase">Bigrams</dt>
			<dd class="flex items-baseline gap-2">
				<span class="font-mono text-2xl font-medium tabular-nums">
					{delta.bigrams.drilled}
				</span>
				<span class="font-mono text-xs text-base-content/45">drilled</span>
			</dd>
			<dd class="font-mono text-xs text-base-content/45 tabular-nums">
				{#if delta.bigrams.graduatedToHealthy > 0}
					{delta.bigrams.graduatedToHealthy} graduated
					{#if delta.bigrams.regressed > 0}· {delta.bigrams.regressed} regressed{/if}
				{:else if delta.bigrams.regressed > 0}
					{delta.bigrams.regressed} regressed
				{:else}
					no class changes
				{/if}
			</dd>
		</div>
	</dl>
</section>
