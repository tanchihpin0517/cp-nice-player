import { execFile } from 'child_process';
import { promisify } from 'util';
import * as vscode from 'vscode';
import { getPlaybackFormat, getDebugLogging } from './config';
import {
	EncodeFormat,
	EncoderCapabilities,
	isEncodeFallback,
	primaryEncodeFormat,
	resolveEncodeFormat,
} from './encodeFormat';

const execFileAsync = promisify(execFile);

export const FFMPEG_MISSING_NOTIFIED_KEY = 'ffmpegMissingNotified';

export interface FfmpegCheckResult {
	available: boolean;
	path: string;
	version?: string;
	error?: string;
	encoders?: EncoderCapabilities;
	encodeFormat?: EncodeFormat;
}

let cachedResult: FfmpegCheckResult | undefined;

function parseEncoderCapabilities(encodersOutput: string): EncoderCapabilities {
	const names = new Set<string>();
	for (const line of encodersOutput.split('\n')) {
		const match = line.trim().match(/^[AVS][\w.]+\s+(\S+)/);
		if (match) {
			names.add(match[1]);
		}
	}

	return {
		libvorbis: names.has('libvorbis'),
		libmp3lame: names.has('libmp3lame'),
		flac: names.has('flac'),
	};
}

async function probeEncoderCapabilities(ffmpegPath: string): Promise<EncoderCapabilities> {
	const { stdout } = await execFileAsync(ffmpegPath, ['-hide_banner', '-encoders'], {
		timeout: 10000,
	});
	return parseEncoderCapabilities(stdout);
}

function logEncodeFallbackIfNeeded(preference: ReturnType<typeof getPlaybackFormat>, encodeFormat: EncodeFormat): void {
	if (!isEncodeFallback(preference, encodeFormat)) {
		return;
	}

	if (preference === 'ogg') {
		console.log('cp-nice-player: libvorbis unavailable; using mp3 for playback.');
		return;
	}

	console.log('cp-nice-player: flac encoder unavailable; using wav for playback.');
}

function applyEncodeResolution(
	result: FfmpegCheckResult,
	encoders: EncoderCapabilities,
): FfmpegCheckResult {
	const preference = getPlaybackFormat();
	try {
		const encodeFormat = resolveEncodeFormat(preference, encoders);
		logEncodeFallbackIfNeeded(preference, encodeFormat);
		if (getDebugLogging()) {
			console.log(
				`cp-nice-player: encode format resolved: preference=${preference}, encodeFormat=${encodeFormat}`,
			);
		}
		return { ...result, encoders, encodeFormat };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return {
			available: false,
			path: result.path,
			error: message,
			encoders,
		};
	}
}

export function getEffectiveEncodeFormat(): EncodeFormat {
	if (cachedResult?.encodeFormat) {
		return cachedResult.encodeFormat;
	}

	return primaryEncodeFormat(getPlaybackFormat());
}

export function refreshEncodeFormatResolution(): void {
	if (!cachedResult?.available || !cachedResult.encoders) {
		return;
	}

	const preference = getPlaybackFormat();
	try {
		const encodeFormat = resolveEncodeFormat(preference, cachedResult.encoders);
		logEncodeFallbackIfNeeded(preference, encodeFormat);
		cachedResult = { ...cachedResult, encodeFormat };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		cachedResult = {
			available: false,
			path: cachedResult.path,
			error: message,
			encoders: cachedResult.encoders,
		};
	}
}

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
			const encoders = await probeEncoderCapabilities(candidate);

			cachedResult = applyEncodeResolution(
				{
					available: true,
					path: candidate,
					version: versionLine,
				},
				encoders,
			);
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
		`FFmpeg was not found. Playback is unavailable until FFmpeg is installed. ${detail}`,
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
