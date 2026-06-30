import * as fs from 'fs/promises';
import { getPlaybackFormat, getPlaybackOggQuality } from '../../config';
import { FfmpegCheckResult } from '../../ffmpegHost';
import { transcodeChunk } from './ffmpegChunk';
import {
	chunkFilePath,
	contentTypeForFormat,
	tempChunkFilePath,
} from './cache';
import { StreamContext } from './resolve';
import { getChunkEntry, StreamIndexManifest } from './indexBuilder';

export class ChunkOutOfRangeError extends Error {
	constructor(index: number, count: number) {
		super(`Chunk index ${index} is out of range (count=${count})`);
		this.name = 'ChunkOutOfRangeError';
	}
}

export type ChunkCacheStatus = 'hit' | 'miss';

export interface ChunkBytes {
	buffer: Buffer;
	contentType: string;
	index: number;
	startSec: number;
	durationSec: number;
	cache: ChunkCacheStatus;
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

function chunkKey(cacheDirName: string, index: number): string {
	return `${cacheDirName}:${index}`;
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

async function readChunkFromDisk(
	streamCtx: StreamContext,
	index: number,
	manifest: StreamIndexManifest,
): Promise<ChunkBytes | undefined> {
	const format = getPlaybackFormat();
	const filePath = chunkFilePath(streamCtx.cacheDirFsPath, index, format);

	try {
		const buffer = await fs.readFile(filePath);
		const { startSec, durationSec } = chunkTimingFromManifest(index, manifest);
		return {
			buffer,
			contentType: contentTypeForFormat(format),
			index,
			startSec,
			durationSec,
			cache: 'hit',
		};
	} catch {
		return undefined;
	}
}

async function generateChunk(
	streamCtx: StreamContext,
	ffmpeg: FfmpegCheckResult,
	index: number,
	manifest: StreamIndexManifest,
): Promise<ChunkBytes> {
	const existing = await readChunkFromDisk(streamCtx, index, manifest);
	if (existing) {
		return existing;
	}

	if (!ffmpeg.available) {
		throw new Error(ffmpeg.error ?? 'FFmpeg is not available.');
	}

	const format = getPlaybackFormat();
	const oggQuality = getPlaybackOggQuality();
	const { startSec, encodeEndSec, durationSec } = chunkTimingFromManifest(index, manifest);

	if (durationSec <= 0 || encodeEndSec <= startSec) {
		throw new ChunkOutOfRangeError(index, manifest.chunking.count);
	}

	await fs.mkdir(streamCtx.cacheDirFsPath, { recursive: true });

	const outputPath = chunkFilePath(streamCtx.cacheDirFsPath, index, format);
	const tempPath = tempChunkFilePath(streamCtx.cacheDirFsPath, index, format);

	return runSerialTranscode(async () => {
		const cachedAfterWait = await readChunkFromDisk(streamCtx, index, manifest);
		if (cachedAfterWait) {
			return cachedAfterWait;
		}

		try {
			await transcodeChunk(ffmpeg.path, streamCtx.fsPath, tempPath, {
				startSec,
				endSec: encodeEndSec,
				format,
				oggQuality,
			});
			await fs.rename(tempPath, outputPath);
		} catch (err) {
			await fs.rm(tempPath, { force: true }).catch(() => undefined);
			throw err;
		}

		const buffer = await fs.readFile(outputPath);
		return {
			buffer,
			contentType: contentTypeForFormat(format),
			index,
			startSec,
			durationSec,
			cache: 'miss',
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

	const cached = await readChunkFromDisk(streamCtx, index, manifest);
	if (cached) {
		return cached;
	}

	const key = chunkKey(streamCtx.cacheDirName, index);
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
