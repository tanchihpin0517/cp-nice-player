import { AudioPacket } from './probe';

export interface ChunkEntry {
	index: number;
	startSec: number;
	endSec: number;
	startByte: number;
	endByte: number;
	startFrame: number;
	endFrame: number;
	crossfadeEndFrame: number;
	crossfadeEndSec: number;
}

function packetEndSec(packet: AudioPacket): number {
	return packet.ptsTimeSec + packet.durationSec;
}

export function findCrossfadeTail(
	packets: AudioPacket[],
	endFrame: number,
	endSec: number,
	crossfadeSec: number,
	isFinal: boolean,
): { crossfadeEndFrame: number; crossfadeEndSec: number } {
	if (isFinal || crossfadeSec <= 0) {
		return { crossfadeEndFrame: endFrame, crossfadeEndSec: endSec };
	}

	const targetSec = endSec + crossfadeSec;
	let bestIndex = endFrame;
	let bestDistance = Math.abs(packetEndSec(packets[endFrame]) - targetSec);

	for (let i = endFrame + 1; i < packets.length; i += 1) {
		const distance = Math.abs(packetEndSec(packets[i]) - targetSec);
		if (distance < bestDistance) {
			bestDistance = distance;
			bestIndex = i;
		}
	}

	const minIndex = endFrame + 1;
	if (bestIndex < minIndex && minIndex < packets.length) {
		bestIndex = minIndex;
	}

	const tailPacket = packets[bestIndex];
	return {
		crossfadeEndFrame: tailPacket.index,
		crossfadeEndSec: packetEndSec(tailPacket),
	};
}

export function inferFrameAlignedChunks(
	packets: AudioPacket[],
	targetDurationSec: number,
	fileSize: number,
	crossfadeSec = 0,
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
		const endSec = endPacket.ptsTimeSec + endPacket.durationSec;
		const isFinal = end + 1 >= packets.length;
		const tail = findCrossfadeTail(
			packets,
			endPacket.index,
			endSec,
			crossfadeSec,
			isFinal,
		);

		chunks.push({
			index: chunks.length,
			startSec: startPacket.ptsTimeSec,
			endSec,
			startByte: startPacket.bytePos,
			endByte,
			startFrame: startPacket.index,
			endFrame: endPacket.index,
			crossfadeEndFrame: tail.crossfadeEndFrame,
			crossfadeEndSec: tail.crossfadeEndSec,
		});

		start = end + 1;
	}

	return chunks;
}
