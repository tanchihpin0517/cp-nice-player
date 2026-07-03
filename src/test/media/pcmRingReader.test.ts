import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JS module
import { PcmRingReader } from '../../../media/engine/pcmRingReader.js';

describe('PcmRingReader', () => {
	it('writeBlock respects backpressure', () => {
		const ring = new PcmRingReader(2, 4);
		const block = [new Float32Array([1, 2, 3, 4, 5]), new Float32Array([1, 2, 3, 4, 5])];

		const accepted = ring.writeBlock(block);
		expect(accepted).toBe(4);
		expect(ring.framesAvailable).toBe(4);
		expect(ring.freeFrames()).toBe(0);
		expect(ring.writeBlock(block)).toBe(0);
	});

	it('read outputs silence on underrun', () => {
		const ring = new PcmRingReader(2, 4);
		const out = [new Float32Array(3), new Float32Array(3)];

		ring.read(out, 3);
		expect(out[0]).toEqual(new Float32Array(3));
		expect(ring.underrunFrames).toBe(3);
	});

	it('read consumes written frames', () => {
		const ring = new PcmRingReader(1, 8);
		ring.writeBlock([new Float32Array([0.1, 0.2, 0.3])]);

		const out = [new Float32Array(2)];
		ring.read(out, 2);
		expect(out[0][0]).toBeCloseTo(0.1);
		expect(out[0][1]).toBeCloseTo(0.2);
		expect(ring.framesAvailable).toBe(1);
	});

	it('wraps read and write indices', () => {
		const ring = new PcmRingReader(1, 3);
		ring.writeBlock([new Float32Array([1, 2, 3])]);
		const out = [new Float32Array(2)];
		ring.read(out, 2);
		ring.writeBlock([new Float32Array([4, 5])]);

		expect(ring.framesAvailable).toBe(3);
		const out2 = [new Float32Array(3)];
		ring.read(out2, 3);
		expect(out2[0][0]).toBeCloseTo(3);
		expect(out2[0][1]).toBeCloseTo(4);
		expect(out2[0][2]).toBeCloseTo(5);
	});

	it('reset clears buffers and counters', () => {
		const ring = new PcmRingReader(1, 4);
		ring.writeBlock([new Float32Array([1, 2])]);
		ring.read([new Float32Array(1)], 1);
		ring.reset();

		expect(ring.framesAvailable).toBe(0);
		expect(ring.underrunFrames).toBe(0);
		expect(ring.stats().freeFrames).toBe(4);
	});
});
