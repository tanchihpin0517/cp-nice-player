import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JS module
import {
	buildLinearFade,
	findWsolaOffset,
	linearCrossfade,
	normalizedCrossCorrelation,
} from '../../../media/engine/crossfade.js';

describe('crossfade', () => {
	describe('buildLinearFade', () => {
		it('fade ramps sum to 1 per sample', () => {
			const { fadeIn, fadeOut } = buildLinearFade(8);
			for (let i = 0; i < 8; i += 1) {
				expect(fadeIn[i] + fadeOut[i]).toBeCloseTo(1);
			}
		});
	});

	describe('normalizedCrossCorrelation', () => {
		it('returns 1 for identical signals', () => {
			const signal = new Float32Array([1, 0, -1, 0.5]);
			const tail = [signal];
			const head = [signal];
			const score = normalizedCrossCorrelation(tail, head, 0, 4);
			expect(score).toBeCloseTo(1);
		});
	});

	describe('findWsolaOffset', () => {
		it('picks offset with best correlation', () => {
			const blendFrames = 4;
			const tail = [new Float32Array([1, 0, -1, 0])];
			const headData = new Float32Array([0, 0, 0, 0, 1, 0, -1, 0, 0]);
			const head = [headData];

			const offset = findWsolaOffset(tail, head, blendFrames, 4, 0);
			expect(offset).toBe(4);
		});

		it('picks negative offset when best match is before baseOffset', () => {
			const blendFrames = 4;
			const tail = [new Float32Array([1, 0, -1, 0])];
			const headData = new Float32Array([0, 0, 1, 0, -1, 0, 0, 0, 0]);
			const head = [headData];

			const offset = findWsolaOffset(tail, head, blendFrames, 4, 4);
			expect(offset).toBe(-2);
		});

		it('does not return negative offset when baseOffset is zero', () => {
			const blendFrames = 4;
			const tail = [new Float32Array([1, 0, -1, 0])];
			const headData = new Float32Array([0, 0, 1, 0, -1, 0, 0, 0, 0]);
			const head = [headData];

			const offset = findWsolaOffset(tail, head, blendFrames, 4, 0);
			expect(offset).toBeGreaterThanOrEqual(0);
		});
	});

	describe('linearCrossfade', () => {
		it('blends tail and head with fades', () => {
			const blendFrames = 2;
			const { fadeIn, fadeOut } = buildLinearFade(blendFrames);
			const tail = [new Float32Array([1, 1])];
			const head = [new Float32Array([0, 0])];
			const blended = linearCrossfade(tail, head, 0, blendFrames, fadeIn, fadeOut);

			expect(blended[0][0]).toBeCloseTo(tail[0][0] * fadeOut[0] + head[0][0] * fadeIn[0]);
			expect(blended[0][1]).toBeCloseTo(tail[0][1] * fadeOut[1] + head[0][1] * fadeIn[1]);
		});
	});
});
