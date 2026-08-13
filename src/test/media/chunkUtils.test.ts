import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JS module
import {
	chunkEntry,
	chunkIndexForTime,
	computeChunkPeaks,
	formatChunkRanges,
	PEAKS_PER_CHUNK,
} from '../../../media/engine/chunkUtils.js';
import { validManifest } from './helpers/manifestFixtures';

describe('chunkUtils', () => {
	describe('chunkIndexForTime', () => {
		it('returns chunk index at boundaries', () => {
			const manifest = validManifest();
			expect(chunkIndexForTime(manifest, 0)).toBe(0);
			expect(chunkIndexForTime(manifest, 0.99)).toBe(0);
			expect(chunkIndexForTime(manifest, 1)).toBe(1);
			expect(chunkIndexForTime(manifest, 4.5)).toBe(4);
		});

		it('clamps negative time to chunk 0', () => {
			const manifest = validManifest();
			expect(chunkIndexForTime(manifest, -5)).toBe(0);
		});

		it('returns 0 for empty manifest', () => {
			expect(chunkIndexForTime(null, 1)).toBe(0);
			expect(chunkIndexForTime({ chunking: { chunks: [] } }, 1)).toBe(0);
		});
	});

	describe('chunkEntry', () => {
		it('returns chunk at index', () => {
			const manifest = validManifest();
			expect(chunkEntry(manifest, 2)?.index).toBe(2);
		});

		it('returns undefined for missing index', () => {
			const manifest = validManifest();
			expect(chunkEntry(manifest, 99)).toBeUndefined();
		});
	});

	describe('formatChunkRanges', () => {
		it('returns em dash for empty list', () => {
			expect(formatChunkRanges([])).toBe('—');
		});

		it('formats singles and ranges', () => {
			expect(formatChunkRanges([1, 3, 4, 5, 8])).toBe('1, 3-5, 8');
		});

		it('formats contiguous range', () => {
			expect(formatChunkRanges([2, 3, 4])).toBe('2-4');
		});
	});

	describe('computeChunkPeaks', () => {
		it('returns one bucket per slice at the default resolution', () => {
			const peaks = computeChunkPeaks([new Float32Array(320)], 320);
			expect(peaks).toHaveLength(PEAKS_PER_CHUNK);
		});

		it('keeps the largest magnitude in each slice, ignoring sign', () => {
			// Four frames, two buckets: [0.25, -0.5] then [0.125, 0.75].
			const channel = Float32Array.from([0.25, -0.5, 0.125, 0.75]);
			expect(Array.from(computeChunkPeaks([channel], 4, 2))).toEqual([0.5, 0.75]);
		});

		it('takes the loudest channel at each position', () => {
			// Binary fractions throughout: Float32Array would round 0.1 or 0.9.
			const left = Float32Array.from([0.125, 0.125]);
			const right = Float32Array.from([0.875, 0.25]);
			expect(Array.from(computeChunkPeaks([left, right], 2, 2))).toEqual([0.875, 0.25]);
		});

		it('measures only the requested frames, not the crossfade tail past them', () => {
			// The tail belongs to the next chunk and must not count twice.
			const channel = Float32Array.from([0.25, 0.25, 1.0, 1.0]);
			expect(Array.from(computeChunkPeaks([channel], 2, 1))).toEqual([0.25]);
		});

		it('reports silence as zero rather than as missing data', () => {
			const peaks = computeChunkPeaks([new Float32Array(64)], 64, 4);
			expect(Array.from(peaks)).toEqual([0, 0, 0, 0]);
		});

		it('clamps magnitudes above full scale', () => {
			const channel = Float32Array.from([1.4, -2.1]);
			expect(Array.from(computeChunkPeaks([channel], 2, 1))).toEqual([1]);
		});

		it('returns zeroes for an empty buffer instead of throwing', () => {
			expect(Array.from(computeChunkPeaks([new Float32Array(0)], 0, 3))).toEqual([0, 0, 0]);
		});
	});
});
