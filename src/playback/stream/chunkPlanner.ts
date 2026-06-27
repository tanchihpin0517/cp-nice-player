import { AudioPacket } from './probe';

export interface ChunkEntry {
	index: number;
	startSec: number;
	endSec: number;
	startByte: number;
	endByte: number;
	startFrame: number;
	endFrame: number;
}

export function inferFrameAlignedChunks(
	packets: AudioPacket[],
	targetDurationSec: number,
	fileSize: number,
): ChunkEntry[] {
	if (!Number.isFinite(targetDurationSec) || targetDurationSec <= 0) {
		throw new Error(`Invalid target duration: ${targetDurationSec}`);
	}
	if (packets.length === 0) {
		throw new Error('No packets available for chunk planning.');
	}

	const chunks: ChunkEntry[] = [];
	let start = 0;

	while (start < packets.length) {
		let end = start;
		const chunkStartSec = packets[start].ptsTimeSec;

		while (end + 1 < packets.length) {
			const nextEndSec = packets[end + 1].ptsTimeSec + packets[end + 1].durationSec;
			if (nextEndSec - chunkStartSec > targetDurationSec) {
				break;
			}
			end += 1;
		}

		const startPacket = packets[start];
		const endPacket = packets[end];
		const endByte = Math.max(
			endPacket.bytePos + endPacket.sizeBytes - 1,
			end + 1 < packets.length ? packets[end + 1].bytePos - 1 : fileSize - 1,
		);

		chunks.push({
			index: chunks.length,
			startSec: startPacket.ptsTimeSec,
			endSec: endPacket.ptsTimeSec + endPacket.durationSec,
			startByte: startPacket.bytePos,
			endByte,
			startFrame: startPacket.index,
			endFrame: endPacket.index,
		});

		start = end + 1;
	}

	return chunks;
}
