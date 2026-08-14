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
import {
	findManagedFfmpeg,
	formatBytes,
	installManagedFfmpeg,
	MANAGED_FFMPEG_BRANCH,
	managedFfmpegUnsupportedReason,
	resolveManagedAsset,
} from './ffmpegDownload';

const execFileAsync = promisify(execFile);

export const FFMPEG_MISSING_NOTIFIED_KEY = 'ffmpegMissingNotified';

/** Where the pinned builds come from, shown behind the notification's "Learn More". */
const MANAGED_FFMPEG_HOME_URL = 'https://github.com/BtbN/FFmpeg-Builds';

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

/**
 * Last resolved ffmpeg check, without triggering a probe. Callers that must stay synchronous
 * and cheap (e.g. the /health route) use this instead of `checkFfmpegAvailable()`.
 */
export function getCachedFfmpegResult(): FfmpegCheckResult | undefined {
	return cachedResult;
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

function getConfiguredFfmpegPath(): string | undefined {
	const configured = vscode.workspace
		.getConfiguration('cp-nice-player')
		.get<string>('ffmpegPath')
		?.trim();
	return configured ? configured : undefined;
}

export async function checkFfmpegAvailable(force = false): Promise<FfmpegCheckResult> {
	if (cachedResult && !force) {
		return cachedResult;
	}

	// An explicit setting wins outright: if the user named an ffmpeg, silently
	// running a different one would hide their mistake rather than surface it.
	const configuredPath = getConfiguredFfmpegPath();
	const managedPath = configuredPath ? undefined : await findManagedFfmpeg();
	const candidates = configuredPath
		? [configuredPath]
		: managedPath
			? ['ffmpeg', managedPath]
			: ['ffmpeg'];

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

async function openFfmpegPathSetting(): Promise<void> {
	await vscode.commands.executeCommand(
		'workbench.action.openSettings',
		'cp-nice-player.ffmpegPath',
	);
}

async function promptForMissingFfmpeg(
	context: vscode.ExtensionContext,
	ffmpeg: FfmpegCheckResult,
): Promise<void> {
	const detail = ffmpeg.error ?? 'Install ffmpeg and ensure it is on your PATH.';
	const asset = getConfiguredFfmpegPath() ? undefined : resolveManagedAsset();

	if (!asset) {
		void vscode.window.showInformationMessage(
			`FFmpeg was not found. Playback is unavailable until FFmpeg is installed. ${detail}`,
		);
		return;
	}

	const download = `Download FFmpeg (${formatBytes(asset.sizeBytes)})`;
	const setPath = 'Set Path…';
	const learnMore = 'Learn More';
	const choice = await vscode.window.showInformationMessage(
		`FFmpeg was not found. ${detail} CP's Nice Player can download a pinned FFmpeg ${MANAGED_FFMPEG_BRANCH} build for this machine.`,
		download,
		setPath,
		learnMore,
	);

	if (choice === download) {
		await downloadManagedFfmpeg(context);
		return;
	}
	if (choice === setPath) {
		await openFfmpegPathSetting();
		return;
	}
	if (choice === learnMore) {
		await vscode.env.openExternal(vscode.Uri.parse(MANAGED_FFMPEG_HOME_URL));
	}
}

export async function maybeNotifyFfmpegMissingOnce(
	context: vscode.ExtensionContext,
	ffmpeg: FfmpegCheckResult,
): Promise<void> {
	if (ffmpeg.available || context.globalState.get(FFMPEG_MISSING_NOTIFIED_KEY)) {
		return;
	}

	// Recorded before the prompt is shown so the concurrent activation paths that
	// both warm ffmpeg cannot stack two notifications.
	await context.globalState.update(FFMPEG_MISSING_NOTIFIED_KEY, true);
	void promptForMissingFfmpeg(context, ffmpeg);
}

async function warnConfiguredPathShadowsManaged(installedPath: string): Promise<void> {
	const configured = getConfiguredFfmpegPath();
	if (!configured) {
		return;
	}

	const clear = 'Clear Setting';
	const choice = await vscode.window.showWarningMessage(
		`FFmpeg was installed at ${installedPath}, but cp-nice-player.ffmpegPath is set to "${configured}" and takes precedence.`,
		clear,
		'Open Setting',
	);

	if (choice === clear) {
		await vscode.workspace
			.getConfiguration('cp-nice-player')
			.update('ffmpegPath', undefined, vscode.ConfigurationTarget.Global);
		return;
	}
	if (choice) {
		await openFfmpegPathSetting();
	}
}

/**
 * Downloads and installs the pinned FFmpeg build, then re-resolves the host so
 * playback can start without a reload. Returns the refreshed check result.
 */
export async function downloadManagedFfmpeg(
	context: vscode.ExtensionContext,
): Promise<FfmpegCheckResult> {
	const unsupported = managedFfmpegUnsupportedReason();
	if (unsupported) {
		void vscode.window.showWarningMessage(
			`${unsupported} Install FFmpeg with your package manager, then set cp-nice-player.ffmpegPath if it is not on PATH.`,
		);
		return checkFfmpegAvailable();
	}

	let installedPath: string;
	try {
		installedPath = await vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: "CP's Nice Player: installing FFmpeg",
				cancellable: true,
			},
			(progress, token) => installManagedFfmpeg(progress, token),
		);
	} catch (err) {
		// The install did not happen, so re-arm the one-time prompt: otherwise a
		// cancelled or failed download leaves the user with no FFmpeg and no offer
		// to try again.
		await context.globalState.update(FFMPEG_MISSING_NOTIFIED_KEY, undefined);

		if (!(err instanceof vscode.CancellationError)) {
			const message = err instanceof Error ? err.message : String(err);
			void vscode.window.showErrorMessage(`FFmpeg download failed. ${message}`);
		}
		return checkFfmpegAvailable();
	}

	cachedResult = undefined;
	const refreshed = await checkFfmpegAvailable(true);

	if (refreshed.available) {
		void vscode.window.showInformationMessage(
			`FFmpeg is ready. ${refreshed.version ?? installedPath}`,
		);
	}
	void warnConfiguredPathShadowsManaged(installedPath);

	return refreshed;
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
