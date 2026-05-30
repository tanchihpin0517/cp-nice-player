import { createHash } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import { CacheFormat, getCacheFormat, getCacheOggQuality } from './config';
import { FfmpegCheckResult, transcodeForCache } from './ffmpeg';

const TRANSCODE_DIR_NAME = 'transcode';
const MAX_BASENAME_LENGTH = 80;

export interface CachedAudioResult {
	uri: vscode.Uri;
	fileName: string;
	fsPath: string;
	format: CacheFormat;
}

export function getTranscodeDir(context: vscode.ExtensionContext): vscode.Uri {
	return vscode.Uri.joinPath(context.globalStorageUri, TRANSCODE_DIR_NAME);
}

export async function cleanTranscodeDir(context: vscode.ExtensionContext): Promise<void> {
	const dir = getTranscodeDir(context);
	try {
		await fs.mkdir(dir.fsPath, { recursive: true });
		const entries = await fs.readdir(dir.fsPath);
		await Promise.all(
			entries.map((entry) =>
				fs.rm(path.join(dir.fsPath, entry), { recursive: true, force: true }),
			),
		);
	} catch (err) {
		console.error("cp-nice-player: failed to clean transcode dir", err);
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

function sanitizeFileStem(fileName: string): string {
	const stem = path.basename(fileName, path.extname(fileName));
	return sanitizeNameSegment(stem, 'audio');
}

function sanitizeSourceExt(fileName: string): string {
	const ext = path.extname(fileName).slice(1).toLowerCase();
	return sanitizeNameSegment(ext, 'bin');
}

async function computeCacheHash(
	fsPath: string,
	mtimeMs: number,
	size: number,
	format: CacheFormat,
	oggQuality: number,
): Promise<string> {
	const payload = `${fsPath}\0${mtimeMs}\0${size}\0${format}\0${oggQuality}`;
	return createHash('sha256').update(payload).digest('hex');
}

export async function getCachedFileName(mediaUri: vscode.Uri): Promise<string> {
	const format = getCacheFormat();
	const oggQuality = getCacheOggQuality();
	const stat = await fs.stat(mediaUri.fsPath);
	const baseName = path.basename(mediaUri.fsPath);
	const fileStem = sanitizeFileStem(baseName);
	const sourceExt = sanitizeSourceExt(baseName);
	const hash = await computeCacheHash(mediaUri.fsPath, stat.mtimeMs, stat.size, format, oggQuality);
	const outputExt = format === 'flac' ? 'flac' : 'ogg';
	return `${fileStem}_${sourceExt}_${hash}.${outputExt}`;
}

export async function ensureCachedAudio(
	context: vscode.ExtensionContext,
	mediaUri: vscode.Uri,
	ffmpeg: FfmpegCheckResult,
	signal?: AbortSignal,
): Promise<CachedAudioResult> {
	if (!ffmpeg.available) {
		throw new Error(ffmpeg.error ?? 'FFmpeg is not available.');
	}

	const format = getCacheFormat();
	const oggQuality = getCacheOggQuality();
	const transcodeDir = getTranscodeDir(context);
	await fs.mkdir(transcodeDir.fsPath, { recursive: true });

	const fileName = await getCachedFileName(mediaUri);
	const outputFsPath = path.join(transcodeDir.fsPath, fileName);
	const tempFsPath = path.join(transcodeDir.fsPath, `temp_${fileName}`);

	try {
		await fs.access(outputFsPath);
		return {
			uri: vscode.Uri.file(outputFsPath),
			fileName,
			fsPath: outputFsPath,
			format,
		};
	} catch {
		// cache miss — transcode below
	}

	try {
		await transcodeForCache(
			ffmpeg.path,
			mediaUri.fsPath,
			tempFsPath,
			format,
			oggQuality,
			signal,
		);
		await fs.rename(tempFsPath, outputFsPath);
	} catch (err) {
		await fs.rm(tempFsPath, { force: true }).catch(() => undefined);
		throw err;
	}

	return {
		uri: vscode.Uri.file(outputFsPath),
		fileName,
		fsPath: outputFsPath,
		format,
	};
}
