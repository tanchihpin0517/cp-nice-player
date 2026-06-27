import * as fs from 'fs/promises';
import { getChunkDurationSec, getPlaybackFormat } from '../../config';
import { FfmpegCheckResult } from '../../ffmpegHost';
import { inferFrameAlignedChunks, ChunkEntry } from './chunkPlanner';
import { scanAudioFrames } from './probe';
import {
	contentTypeForFormat,
	indexJsonPath,
	outputExtForFormat,
} from './cache';
import { StreamContext } from './resolve';

export interface StreamIndexManifest {
	version: 1;
	durationSec: number;
	channels: number;
	sampleRate: number;
	encode: {
		format: string;
		codec: string;
		contentType: string;
	};
	chunking: {
		targetDurationSec: number;
		count: number;
		strategy: 'frame-aligned';
		chunks: ChunkEntry[];
	};
}

function isValidChunkEntry(value: unknown, index: number, prev?: ChunkEntry): value is ChunkEntry {
	if (!value || typeof value !== 'object') {
		return false;
	}
	const entry = value as ChunkEntry;
	if (
		entry.index !== index ||
		!Number.isFinite(entry.startSec) ||
		!Number.isFinite(entry.endSec) ||
		entry.endSec <= entry.startSec ||
		!Number.isInteger(entry.startByte) ||
		!Number.isInteger(entry.endByte) ||
		entry.startByte < 0 ||
		entry.endByte < entry.startByte ||
		!Number.isInteger(entry.startFrame) ||
		!Number.isInteger(entry.endFrame) ||
		entry.startFrame < 0 ||
		entry.endFrame < entry.startFrame
	) {
		return false;
	}

	if (prev) {
		if (entry.startSec < prev.startSec || entry.startByte < prev.startByte || entry.startFrame <= prev.endFrame) {
			return false;
		}
	}

	return true;
}

export function isValidStreamIndexManifest(value: unknown): value is StreamIndexManifest {
	if (!value || typeof value !== 'object') {
		return false;
	}

	const manifest = value as StreamIndexManifest;
	const chunks = manifest.chunking?.chunks;
	if (!Array.isArray(chunks) || chunks.length === 0) {
		return false;
	}
	for (let i = 0; i < chunks.length; i += 1) {
		if (!isValidChunkEntry(chunks[i], i, i > 0 ? chunks[i - 1] : undefined)) {
			return false;
		}
	}

	return (
		manifest.version === 1 &&
		Number.isFinite(manifest.durationSec) &&
		manifest.durationSec > 0 &&
		Number.isInteger(manifest.channels) &&
		manifest.channels > 0 &&
		Number.isInteger(manifest.sampleRate) &&
		manifest.sampleRate > 0 &&
		typeof manifest.encode?.format === 'string' &&
		typeof manifest.encode?.codec === 'string' &&
		typeof manifest.encode?.contentType === 'string' &&
		Number.isFinite(manifest.chunking?.targetDurationSec) &&
		manifest.chunking.targetDurationSec > 0 &&
		Number.isInteger(manifest.chunking?.count) &&
		manifest.chunking.count === chunks.length &&
		manifest.chunking.strategy === 'frame-aligned'
	);
}

function buildManifest(
	frameScan: Awaited<ReturnType<typeof scanAudioFrames>>,
): StreamIndexManifest {
	const format = getPlaybackFormat();
	const targetDurationSec = getChunkDurationSec();
	const chunks = inferFrameAlignedChunks(frameScan.packets, targetDurationSec, frameScan.fileSize);
	const outputExt = outputExtForFormat(format);

	return {
		version: 1,
		durationSec: frameScan.probe.durationSec,
		channels: frameScan.probe.channels,
		sampleRate: frameScan.probe.sampleRate,
		encode: {
			format: outputExt,
			codec: outputExt,
			contentType: contentTypeForFormat(format),
		},
		chunking: {
			targetDurationSec,
			count: chunks.length,
			strategy: 'frame-aligned',
			chunks,
		},
	};
}

export type IndexCacheStatus = 'hit' | 'miss';

export interface IndexResult {
	manifest: StreamIndexManifest;
	cache: IndexCacheStatus;
}

const indexInFlight = new Map<string, Promise<IndexResult>>();

async function readCachedIndex(indexPath: string): Promise<StreamIndexManifest | undefined> {
	try {
		const cached = await fs.readFile(indexPath, 'utf8');
		const parsed: unknown = JSON.parse(cached);
		if (isValidStreamIndexManifest(parsed)) {
			return parsed;
		}
	} catch {
		// cache miss
	}
	return undefined;
}

export function getChunkEntry(manifest: StreamIndexManifest, index: number): ChunkEntry {
	const chunk = manifest.chunking.chunks[index];
	if (!chunk) {
		throw new Error(`Chunk index ${index} is out of range (count=${manifest.chunking.count})`);
	}
	return chunk;
}

export async function getOrCreateIndex(
	streamCtx: StreamContext,
	ffmpeg: FfmpegCheckResult,
): Promise<IndexResult> {
	const indexPath = indexJsonPath(streamCtx.cacheDirFsPath);
	const cached = await readCachedIndex(indexPath);
	if (cached) {
		return { manifest: cached, cache: 'hit' };
	}

	if (!ffmpeg.available) {
		throw new Error(ffmpeg.error ?? 'FFmpeg is not available.');
	}
	const inFlight = indexInFlight.get(streamCtx.cacheDirName);
	if (inFlight) {
		return inFlight;
	}

	const task = (async (): Promise<IndexResult> => {
		await fs.mkdir(streamCtx.cacheDirFsPath, { recursive: true });
		const recached = await readCachedIndex(indexPath);
		if (recached) {
			return { manifest: recached, cache: 'hit' };
		}

		const frameScan = await scanAudioFrames(ffmpeg.path, streamCtx.fsPath);
		const manifest = buildManifest(frameScan);
		const tempPath = `${indexPath}.tmp`;
		await fs.writeFile(tempPath, JSON.stringify(manifest, null, 2), 'utf8');
		await fs.rename(tempPath, indexPath);
		return { manifest, cache: 'miss' };
	})().finally(() => {
		indexInFlight.delete(streamCtx.cacheDirName);
	});
	indexInFlight.set(streamCtx.cacheDirName, task);
	return task;
}
