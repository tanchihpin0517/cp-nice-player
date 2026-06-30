import * as assert from 'assert';
import { findCrossfadeTail, inferFrameAlignedChunks } from '../playback/stream/chunkPlanner';
import { AudioPacket, durationFromPackets } from '../playback/stream/probe';

function packet(
	index: number,
	ptsTimeSec: number,
	durationSec: number,
	bytePos: number,
	sizeBytes: number,
): AudioPacket {
	return { index, ptsTimeSec, durationSec, bytePos, sizeBytes };
}

suite('Probe duration', () => {
	test('derives duration from first and last packet times', () => {
		const packets: AudioPacket[] = [
			packet(0, 0.0, 0.4, 0, 100),
			packet(1, 0.4, 0.4, 100, 100),
			packet(2, 0.8, 0.4, 200, 100),
			packet(3, 1.2, 0.4, 300, 100),
		];

		assert.strictEqual(durationFromPackets(packets), 1.6);
	});
});

suite('Chunk planner', () => {
	test('splits packets around target duration', () => {
		const packets: AudioPacket[] = [
			packet(0, 0.0, 0.4, 0, 100),
			packet(1, 0.4, 0.4, 100, 100),
			packet(2, 0.8, 0.4, 200, 100),
			packet(3, 1.2, 0.4, 300, 100),
		];

		const chunks = inferFrameAlignedChunks(packets, 1.0, 400);
		assert.strictEqual(chunks.length, 2);
		assert.deepStrictEqual(chunks[0], {
			index: 0,
			startSec: 0,
			endSec: 0.8,
			startByte: 0,
			endByte: 199,
			startFrame: 0,
			endFrame: 1,
			crossfadeEndFrame: 1,
			crossfadeEndSec: 0.8,
		});
		assert.deepStrictEqual(chunks[1], {
			index: 1,
			startSec: 0.8,
			endSec: 1.6,
			startByte: 200,
			endByte: 399,
			startFrame: 2,
			endFrame: 3,
			crossfadeEndFrame: 3,
			crossfadeEndSec: 1.6,
		});
	});

	test('keeps one chunk for short files', () => {
		const packets: AudioPacket[] = [packet(0, 0.0, 0.2, 5, 25)];
		const chunks = inferFrameAlignedChunks(packets, 1.0, 30);
		assert.strictEqual(chunks.length, 1);
		assert.strictEqual(chunks[0].startFrame, 0);
		assert.strictEqual(chunks[0].endFrame, 0);
		assert.strictEqual(chunks[0].crossfadeEndFrame, 0);
		assert.strictEqual(chunks[0].crossfadeEndSec, 0.2);
		assert.strictEqual(chunks[0].startByte, 5);
		assert.strictEqual(chunks[0].endByte, 29);
	});

	test('respects exact boundary', () => {
		const packets: AudioPacket[] = [
			packet(0, 0, 0.5, 0, 10),
			packet(1, 0.5, 0.5, 10, 10),
			packet(2, 1.0, 0.5, 20, 10),
		];
		const chunks = inferFrameAlignedChunks(packets, 1.0, 30);
		assert.strictEqual(chunks.length, 2);
		assert.strictEqual(chunks[0].endSec, 1.0);
		assert.strictEqual(chunks[1].startSec, 1.0);
	});

	test('extends non-final chunks by closest crossfade frame', () => {
		const packets: AudioPacket[] = [
			packet(0, 0.0, 0.4, 0, 100),
			packet(1, 0.4, 0.4, 100, 100),
			packet(2, 0.8, 0.4, 200, 100),
			packet(3, 1.2, 0.4, 300, 100),
		];

		const chunks = inferFrameAlignedChunks(packets, 1.0, 400, 0.05);
		assert.strictEqual(chunks[0].endFrame, 1);
		assert.strictEqual(chunks[0].crossfadeEndFrame, 2);
		assert.ok(Math.abs(chunks[0].crossfadeEndSec - 1.2) < 1e-9);
		assert.strictEqual(chunks[1].crossfadeEndFrame, 3);
		assert.ok(Math.abs(chunks[1].crossfadeEndSec - 1.6) < 1e-9);
	});

	test('tiny positive crossfade still includes at least one extra frame', () => {
		const packets: AudioPacket[] = [
			packet(0, 0.0, 0.4, 0, 100),
			packet(1, 0.4, 0.4, 100, 100),
			packet(2, 0.8, 0.4, 200, 100),
			packet(3, 1.2, 0.4, 300, 100),
		];

		const chunks = inferFrameAlignedChunks(packets, 1.0, 400, 0.001);
		assert.strictEqual(chunks.length, 2);
		assert.strictEqual(chunks[0].endFrame, 1);
		assert.strictEqual(chunks[0].crossfadeEndFrame, 2);
		assert.ok(Math.abs(chunks[0].crossfadeEndSec - 1.2) < 1e-9);
	});

	test('crossfadeSec zero leaves encode end at body end', () => {
		const packets: AudioPacket[] = [
			packet(0, 0.0, 0.4, 0, 100),
			packet(1, 0.4, 0.4, 100, 100),
			packet(2, 0.8, 0.4, 200, 100),
		];

		const chunks = inferFrameAlignedChunks(packets, 1.0, 300, 0);
		assert.strictEqual(chunks[0].crossfadeEndFrame, chunks[0].endFrame);
		assert.strictEqual(chunks[0].crossfadeEndSec, chunks[0].endSec);
	});

	test('clamps crossfade tail to last packet near EOF', () => {
		const packets: AudioPacket[] = [
			packet(0, 0.0, 0.4, 0, 100),
			packet(1, 0.4, 0.4, 100, 100),
			packet(2, 0.8, 0.4, 200, 100),
		];

		const tail = findCrossfadeTail(packets, 1, 0.8, 0.5, false);
		assert.strictEqual(tail.crossfadeEndFrame, 2);
		assert.ok(Math.abs(tail.crossfadeEndSec - 1.2) < 1e-9);
	});
});
