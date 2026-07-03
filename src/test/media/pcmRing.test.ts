import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JS module
import { PcmRing } from '../../../media/engine/pcmRing.js';

function createMockAudioBuffer(length: number, channels: number, fill = 0): AudioBuffer {
	const channelData: Float32Array[] = [];
	for (let ch = 0; ch < channels; ch += 1) {
		const data = new Float32Array(length);
		for (let i = 0; i < length; i += 1) {
			data[i] = fill + ch * 0.1 + i * 0.001;
		}
		channelData.push(data);
	}
	return {
		length,
		numberOfChannels: channels,
		sampleRate: 44100,
		getChannelData: (ch: number) => channelData[ch],
	} as AudioBuffer;
}

describe('PcmRing', () => {
	it('computes capacityFrames from sample rate and seconds', () => {
		const ring = new PcmRing(2, 44100, 1);
		expect(ring.capacityFrames).toBe(44100);
	});

	it('writes and tracks available frames capped at capacity', () => {
		const ring = new PcmRing(2, 100, 0.1);
		const buffer = createMockAudioBuffer(50, 2);
		const written = ring.writeFromAudioBuffer(buffer, 0, 30);

		expect(written).toBe(30);
		expect(ring.availableFrames()).toBe(10);
	});

	it('wraps write index around capacity', () => {
		const ring = new PcmRing(1, 100, 0.1);
		const buffer = createMockAudioBuffer(12, 1, 1);
		ring.writeFromAudioBuffer(buffer, 0, 8);
		ring.writeFromAudioBuffer(buffer, 0, 8);

		expect(ring.availableFrames()).toBe(10);
		expect(ring.writeIndex).toBe(6);
		expect(ring.framesWritten).toBe(16);
	});

	it('readChannelSlice handles wrap-around', () => {
		const ring = new PcmRing(1, 5, 0.05);
		const buffer = createMockAudioBuffer(7, 1);
		ring.writeFromAudioBuffer(buffer, 0, 7);

		const slice = ring.readChannelSlice(0, 3, 4);
		expect(slice.length).toBe(4);
		expect(slice[0]).toBeCloseTo(buffer.getChannelData(0)[3]);
		expect(slice[3]).toBeCloseTo(buffer.getChannelData(0)[1]);
	});

	it('reset clears state', () => {
		const ring = new PcmRing(2, 100, 0.1);
		const buffer = createMockAudioBuffer(20, 2);
		ring.writeFromAudioBuffer(buffer, 0, 20);
		ring.reset();

		expect(ring.availableFrames()).toBe(0);
		expect(ring.writeIndex).toBe(0);
		expect(ring.framesWritten).toBe(0);
	});
});
