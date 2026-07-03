import { getChunkDurationSec, getCrossfadeMs, getMaxIndexEntries } from '../../config';
import {
	codecForEncodeFormat,
	contentTypeForEncodeFormat,
	outputExtForEncodeFormat,
} from '../../encodeFormat';
import { FfmpegCheckResult, getEffectiveEncodeFormat } from '../../ffmpegHost';
import { inferFrameAlignedChunks, ChunkEntry } from './chunkPlanner';
import { scanAudioFrames } from './probe';
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
		crossfadeMs: number;
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
		entry.endFrame < entry.startFrame ||
		!Number.isFinite(entry.crossfadeEndSec) ||
		entry.crossfadeEndSec < entry.endSec ||
		!Number.isInteger(entry.crossfadeEndFrame) ||
		entry.crossfadeEndFrame < entry.endFrame
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
		Number.isFinite(manifest.chunking?.crossfadeMs) &&
		manifest.chunking.crossfadeMs >= 0 &&
		Number.isInteger(manifest.chunking?.count) &&
		manifest.chunking.count === chunks.length &&
		manifest.chunking.strategy === 'frame-aligned'
	);
}

function buildManifest(
	frameScan: Awaited<ReturnType<typeof scanAudioFrames>>,
): StreamIndexManifest {
	const format = getEffectiveEncodeFormat();
	const targetDurationSec = getChunkDurationSec();
	const crossfadeMs = getCrossfadeMs();
	const chunks = inferFrameAlignedChunks(
		frameScan.packets,
		targetDurationSec,
		frameScan.fileSize,
		crossfadeMs / 1000,
	);
	const outputExt = outputExtForEncodeFormat(format);

	return {
		version: 1,
		durationSec: frameScan.probe.durationSec,
		channels: frameScan.probe.channels,
		sampleRate: frameScan.probe.sampleRate,
		encode: {
			format: outputExt,
			codec: codecForEncodeFormat(format),
			contentType: contentTypeForEncodeFormat(format),
		},
		chunking: {
			targetDurationSec,
			crossfadeMs,
			count: chunks.length,
			strategy: 'frame-aligned',
			chunks,
		},
	};
}

const indexCache = new Map<string, StreamIndexManifest>();
const indexInFlight = new Map<string, Promise<StreamIndexManifest>>();

function getCachedIndex(key: string): StreamIndexManifest | undefined {
	const manifest = indexCache.get(key);
	if (!manifest) {
		return undefined;
	}
	indexCache.delete(key);
	indexCache.set(key, manifest);
	return manifest;
}

function setCachedIndex(key: string, manifest: StreamIndexManifest): void {
	if (indexCache.has(key)) {
		indexCache.delete(key);
	} else if (indexCache.size >= getMaxIndexEntries()) {
		const oldest = indexCache.keys().next().value;
		if (oldest !== undefined) {
			indexCache.delete(oldest);
		}
	}
	indexCache.set(key, manifest);
}

export function clearStreamIndexCache(): void {
	indexCache.clear();
	indexInFlight.clear();
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
): Promise<StreamIndexManifest> {
	const cached = getCachedIndex(streamCtx.key);
	if (cached) {
		return cached;
	}

	if (!ffmpeg.available) {
		throw new Error(ffmpeg.error ?? 'FFmpeg is not available.');
	}

	const inFlight = indexInFlight.get(streamCtx.key);
	if (inFlight) {
		return inFlight;
	}

	const task = (async (): Promise<StreamIndexManifest> => {
		const recached = getCachedIndex(streamCtx.key);
		if (recached) {
			return recached;
		}

		const frameScan = await scanAudioFrames(ffmpeg.path, streamCtx.fsPath);
		const manifest = buildManifest(frameScan);
		setCachedIndex(streamCtx.key, manifest);
		return manifest;
	})().finally(() => {
		indexInFlight.delete(streamCtx.key);
	});
	indexInFlight.set(streamCtx.key, task);
	return task;
}
