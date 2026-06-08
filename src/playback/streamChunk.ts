import * as fs from 'fs/promises';
import { getPlaybackFormat, getPlaybackOggQuality } from '../config';
import { FfmpegCheckResult, transcodeChunk } from '../ffmpeg';
import {
	chunkFilePath,
	contentTypeForFormat,
	tempChunkFilePath,
} from './streamCache';
import { StreamContext } from './streamResolve';
import { getChunkEntry, StreamIndexManifest } from './streamIndex';

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
const MAX_CONCURRENT_FFMPEG = 2;
let runningFfmpeg = 0;
const ffmpegWaiters: Array<() => void> = [];

async function acquireFfmpegSlot(): Promise<void> {
	if (runningFfmpeg < MAX_CONCURRENT_FFMPEG) {
		runningFfmpeg += 1;
		return;
	}

	await new Promise<void>((resolve) => {
		ffmpegWaiters.push(resolve);
	});
	runningFfmpeg += 1;
}

function releaseFfmpegSlot(): void {
	runningFfmpeg -= 1;
	const next = ffmpegWaiters.shift();
	if (next) {
		next();
	}
}

function chunkKey(cacheDirName: string, index: number): string {
	return `${cacheDirName}:${index}`;
}

function chunkTimingFromManifest(
	index: number,
	manifest: StreamIndexManifest,
): { startSec: number; endSec: number; durationSec: number } {
	const chunk = getChunkEntry(manifest, index);
	return {
		startSec: chunk.startSec,
		endSec: chunk.endSec,
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
	const { startSec, endSec, durationSec } = chunkTimingFromManifest(index, manifest);

	if (durationSec <= 0 || endSec <= startSec) {
		throw new ChunkOutOfRangeError(index, manifest.chunking.count);
	}

	await fs.mkdir(streamCtx.cacheDirFsPath, { recursive: true });

	const outputPath = chunkFilePath(streamCtx.cacheDirFsPath, index, format);
	const tempPath = tempChunkFilePath(streamCtx.cacheDirFsPath, index, format);

	await acquireFfmpegSlot();
	try {
		const cachedAfterWait = await readChunkFromDisk(streamCtx, index, manifest);
		if (cachedAfterWait) {
			return cachedAfterWait;
		}

		await transcodeChunk(ffmpeg.path, streamCtx.fsPath, tempPath, {
			startSec,
			endSec,
			format,
			oggQuality,
		});
		await fs.rename(tempPath, outputPath);
	} catch (err) {
		await fs.rm(tempPath, { force: true }).catch(() => undefined);
		throw err;
	} finally {
		releaseFfmpegSlot();
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
