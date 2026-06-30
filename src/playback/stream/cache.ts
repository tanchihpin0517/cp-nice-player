import { createHash } from 'crypto';
import * as fsSync from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import {
	getChunkDurationSec,
	getCrossfadeMs,
	getPlaybackFormat,
	getPlaybackOggQuality,
	PlaybackFormat,
} from '../../config';

const STREAM_DIR_NAME = 'stream';
const MAX_BASENAME_LENGTH = 80;

export function getStreamCacheDir(context: vscode.ExtensionContext): vscode.Uri {
	return vscode.Uri.joinPath(context.globalStorageUri, STREAM_DIR_NAME);
}

export function cleanStreamCacheDir(context: vscode.ExtensionContext): void {
	const dir = getStreamCacheDir(context);
	try {
		fsSync.mkdirSync(dir.fsPath, { recursive: true });
		for (const entry of fsSync.readdirSync(dir.fsPath)) {
			fsSync.rmSync(path.join(dir.fsPath, entry), { recursive: true, force: true });
		}
	} catch (err) {
		console.error('cp-nice-player: failed to clean stream cache dir', err);
	}
}

function sanitizeNameSegment(value: string, fallback: string): string {
	const sanitized = value
		.replace(/[^\w.-]+/g, '_')
		.replace(/_+/g, '_')
		.replace(/^_|_$/g, '');
	const base = sanitized.length > 0 ? sanitized : fallback;
	return base.slice(0, MAX_BASENAME_LENGTH);
}

export function sanitizeFileStem(fileName: string): string {
	const stem = path.basename(fileName, path.extname(fileName));
	return sanitizeNameSegment(stem, 'audio');
}

export function sanitizeSourceExt(fileName: string): string {
	const ext = path.extname(fileName).slice(1).toLowerCase();
	return sanitizeNameSegment(ext, 'bin');
}

export function computeStreamCacheHash(
	fsPath: string,
	mtimeMs: number,
	size: number,
	format: PlaybackFormat,
	oggQuality: number,
	chunkDurationSec: number,
	crossfadeMs: number,
): string {
	const payload = `${fsPath}\0${mtimeMs}\0${size}\0${format}\0${oggQuality}\0${chunkDurationSec}\0${crossfadeMs}`;
	return createHash('sha256').update(payload).digest('hex');
}

export async function computeCacheDirName(fsPath: string): Promise<string> {
	const stat = await fs.stat(fsPath);
	const baseName = path.basename(fsPath);
	const fileStem = sanitizeFileStem(baseName);
	const sourceExt = sanitizeSourceExt(baseName);
	const format = getPlaybackFormat();
	const oggQuality = getPlaybackOggQuality();
	const chunkDurationSec = getChunkDurationSec();
	const crossfadeMs = getCrossfadeMs();
	const hash = computeStreamCacheHash(
		fsPath,
		stat.mtimeMs,
		stat.size,
		format,
		oggQuality,
		chunkDurationSec,
		crossfadeMs,
	);
	return `${fileStem}_${sourceExt}_${hash}`;
}

export function outputExtForFormat(format: PlaybackFormat): string {
	return format === 'flac' ? 'flac' : 'ogg';
}

export function contentTypeForFormat(format: PlaybackFormat): string {
	return format === 'flac' ? 'audio/flac' : 'audio/ogg';
}

export function indexJsonPath(cacheDirFsPath: string): string {
	return path.join(cacheDirFsPath, 'index.json');
}

export function chunkFilePath(
	cacheDirFsPath: string,
	index: number,
	format: PlaybackFormat,
): string {
	const ext = outputExtForFormat(format);
	return path.join(cacheDirFsPath, `chunk_${index}.${ext}`);
}

export function tempChunkFilePath(
	cacheDirFsPath: string,
	index: number,
	format: PlaybackFormat,
): string {
	const ext = outputExtForFormat(format);
	return path.join(cacheDirFsPath, `temp_chunk_${index}.${ext}`);
}
