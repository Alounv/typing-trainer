/**
 * Round-boundary computation for session text.
 *
 * Given the char lengths of each content chunk (a sentence, a quote, a
 * word) and the separator that joins them, returns the char offsets
 * where round boundaries fall — aligned to chunk ends so no round cuts
 * mid-chunk.
 *
 * Diagnostic sessions pass `roundCount: 1` and get `[]` back (no
 * mid-session beats — it's a measurement).
 */
export function computeRoundBoundaries(
	chunkLengths: readonly number[],
	separatorLength: number,
	roundCount: number
): number[] {
	if (roundCount <= 1 || chunkLengths.length === 0) return [];

	// Pick which chunks are "last of their round" — evenly spaced across
	// the chunk list. For N chunks and R rounds, chunk index
	// ceil(r × N / R) - 1 ends round r (1..R-1). Rounds with 0 chunks
	// allocated collapse into neighbors rather than firing empty beats.
	const totalChunks = chunkLengths.length;
	const boundaryChunkIdx = new Set<number>();
	for (let r = 1; r < roundCount; r++) {
		const idx = Math.min(
			totalChunks - 1,
			Math.max(0, Math.ceil((r * totalChunks) / roundCount) - 1)
		);
		boundaryChunkIdx.add(idx);
	}

	const boundaries: number[] = [];
	let offset = 0;
	for (let i = 0; i < totalChunks; i++) {
		offset += chunkLengths[i];
		if (boundaryChunkIdx.has(i)) boundaries.push(offset);
		if (i < totalChunks - 1) offset += separatorLength;
	}
	return boundaries;
}
