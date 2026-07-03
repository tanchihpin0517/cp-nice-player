import { getPlaybackOggQuality } from '../../config';
import { contentTypeForEncodeFormat } from '../../encodeFormat';
import { FfmpegCheckResult, getEffectiveEncodeFormat } from '../../ffmpegHost';
import { transcodeChunkToBuffer } from './ffmpegChunk';
import { StreamContext } from './resolve';
import { getChunkEntry, StreamIndexManifest } from './indexBuilder';

export class ChunkOutOfRangeError extends Error {
	constructor(index: number, count: number) {
		super(`Chunk index ${index} is out of range (count=${count})`);
		this.name = 'ChunkOutOfRangeError';
	}
}

interface ChunkBytes {
	buffer: Buffer;
	contentType: string;
	index: number;
	startSec: number;
	durationSec: number;
}

const chunkInFlight = new Map<string, Promise<ChunkBytes>>();
let transcodeChain: Promise<unknown> = Promise.resolve();

function runSerialTranscode<T>(task: () => Promise<T>): Promise<T> {
	const next = transcodeChain.then(task, task);
	transcodeChain = next.then(
		() => undefined,
		() => undefined,
	);
	return next;
}

function chunkKey(key: string, index: number): string {
	return `${key}:${index}`;
}

export function chunkTimingFromManifest(
	index: number,
	manifest: StreamIndexManifest,
): { startSec: number; endSec: number; encodeEndSec: number; durationSec: number } {
	const chunk = getChunkEntry(manifest, index);
	return {
		startSec: chunk.startSec,
		endSec: chunk.endSec,
		encodeEndSec: chunk.crossfadeEndSec,
		durationSec: Math.max(0, chunk.endSec - chunk.startSec),
	};
}

async function generateChunk(
	streamCtx: StreamContext,
	ffmpeg: FfmpegCheckResult,
	index: number,
	manifest: StreamIndexManifest,
): Promise<ChunkBytes> {
	if (!ffmpeg.available) {
		throw new Error(ffmpeg.error ?? 'FFmpeg is not available.');
	}

	const format = getEffectiveEncodeFormat();
	const oggQuality = getPlaybackOggQuality();
	const { startSec, encodeEndSec, durationSec } = chunkTimingFromManifest(index, manifest);

	if (durationSec <= 0 || encodeEndSec <= startSec) {
		throw new ChunkOutOfRangeError(index, manifest.chunking.count);
	}

	return runSerialTranscode(async () => {
		const buffer = await transcodeChunkToBuffer(ffmpeg.path, streamCtx.fsPath, {
			startSec,
			endSec: encodeEndSec,
			format,
			oggQuality,
		});
		return {
			buffer,
			contentType: contentTypeForEncodeFormat(format),
			index,
			startSec,
			durationSec,
		};
	});
}

export async function getOrCreateChunk(
	streamCtx: StreamContext,
	ffmpeg: FfmpegCheckResult,
	index: number,
	manifest: StreamIndexManifest,
): Promise<ChunkBytes> {
	if (!Number.isInteger(index) || index < 0 || index >= manifest.chunking.count) {
		throw new ChunkOutOfRangeError(index, manifest.chunking.count);
	}

	const key = chunkKey(streamCtx.key, index);
	const inFlight = chunkInFlight.get(key);
	if (inFlight) {
		return inFlight;
	}

	const promise = generateChunk(streamCtx, ffmpeg, index, manifest).finally(() => {
		chunkInFlight.delete(key);
	});
	chunkInFlight.set(key, promise);
	return promise;
}
