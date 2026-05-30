import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import * as vscode from 'vscode';
import { CacheFormat } from './config';

const execFileAsync = promisify(execFile);

export const FFMPEG_MISSING_NOTIFIED_KEY = 'ffmpegMissingNotified';

export interface FfmpegCheckResult {
	available: boolean;
	path: string;
	version?: string;
	error?: string;
}

let cachedResult: FfmpegCheckResult | undefined;

export async function checkFfmpegAvailable(force = false): Promise<FfmpegCheckResult> {
	if (cachedResult && !force) {
		return cachedResult;
	}

	const configuredPath = vscode.workspace
		.getConfiguration('cp-nice-player')
		.get<string>('ffmpegPath')
		?.trim();
	const candidates = configuredPath ? [configuredPath] : ['ffmpeg'];

	for (const candidate of candidates) {
		try {
			const { stdout } = await execFileAsync(candidate, ['-version'], { timeout: 5000 });
			const versionLine = stdout.split('\n').find((line) => line.trim().length > 0)?.trim();

			cachedResult = {
				available: true,
				path: candidate,
				version: versionLine,
			};
			return cachedResult;
		} catch {
			continue;
		}
	}

	cachedResult = {
		available: false,
		path: configuredPath ?? 'ffmpeg',
		error: configuredPath
			? `Could not run ffmpeg at "${configuredPath}".`
			: 'ffmpeg was not found on PATH.',
	};
	return cachedResult;
}

export async function maybeNotifyFfmpegMissingOnce(
	context: vscode.ExtensionContext,
	ffmpeg: FfmpegCheckResult,
): Promise<void> {
	if (ffmpeg.available || context.globalState.get(FFMPEG_MISSING_NOTIFIED_KEY)) {
		return;
	}

	const detail = ffmpeg.error ?? 'Install ffmpeg and ensure it is on your PATH.';
	void vscode.window.showInformationMessage(
		`FFmpeg was not found. Native playback still works; cache/stream fallback for unsupported formats is disabled. ${detail}`,
	);
	await context.globalState.update(FFMPEG_MISSING_NOTIFIED_KEY, true);
}

export async function warmFfmpegAndNotifyOnce(
	context: vscode.ExtensionContext,
): Promise<FfmpegCheckResult> {
	const ffmpeg = await checkFfmpegAvailable();
	await maybeNotifyFfmpegMissingOnce(context, ffmpeg);
	return ffmpeg;
}

export async function clearFfmpegCache(
	context: vscode.ExtensionContext,
): Promise<FfmpegCheckResult> {
	cachedResult = undefined;
	const ffmpeg = await checkFfmpegAvailable(true);
	await maybeNotifyFfmpegMissingOnce(context, ffmpeg);
	return ffmpeg;
}

function runFfmpeg(
	ffmpegPath: string,
	args: string[],
	signal?: AbortSignal,
): Promise<void> {
	return new Promise((resolve, reject) => {
		const proc = spawn(ffmpegPath, args);
		let stderr = '';

		proc.stderr.setEncoding('utf8');
		proc.stderr.on('data', (chunk: string) => {
			stderr += chunk;
		});

		const onAbort = () => {
			proc.kill('SIGTERM');
			reject(new Error('Transcode aborted'));
		};
		signal?.addEventListener('abort', onAbort, { once: true });

		proc.on('error', (err) => {
			signal?.removeEventListener('abort', onAbort);
			reject(err);
		});

		proc.on('close', (code) => {
			signal?.removeEventListener('abort', onAbort);
			if (signal?.aborted) {
				reject(new Error('Transcode aborted'));
				return;
			}
			if (code === 0) {
				resolve();
			} else {
				const detail = stderr.trim() || `ffmpeg exited with code ${code}`;
				reject(new Error(detail));
			}
		});
	});
}

export async function transcodeForCache(
	ffmpegPath: string,
	inputFsPath: string,
	outputFsPath: string,
	format: CacheFormat,
	oggQuality: number,
	signal?: AbortSignal,
): Promise<void> {
	const args =
		format === 'flac'
			? ['-y', '-i', inputFsPath, '-vn', '-c:a', 'flac', outputFsPath]
			: [
					'-y',
					'-i',
					inputFsPath,
					'-vn',
					'-c:a',
					'libvorbis',
					'-q:a',
					String(oggQuality),
					outputFsPath,
				];
	return runFfmpeg(ffmpegPath, args, signal);
}
