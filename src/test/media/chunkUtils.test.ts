import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JS module
import { chunkEntry, chunkIndexForTime, formatChunkRanges } from '../../../media/engine/chunkUtils.js';
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
});
