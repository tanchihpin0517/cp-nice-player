import * as vscode from 'vscode';
import { logPlaybackSettings } from './config';
import { initManagedFfmpeg } from './ffmpegDownload';
import {
	clearFfmpegCache,
	downloadManagedFfmpeg,
	FFMPEG_MISSING_NOTIFIED_KEY,
	refreshEncodeFormatResolution,
	warmFfmpegAndNotifyOnce,
} from './ffmpegHost';
import { MEDIA_EDITOR_VIEW_TYPE, MediaEditorProvider } from './mediaEditorProvider';
import { isSupportedAudio, MEDIA_FILE_FILTERS } from './mediaTypes';
import { PlaybackService } from './playback/playbackService';

export async function activate(context: vscode.ExtensionContext) {
	logPlaybackSettings();
	initManagedFfmpeg(context);

	const configChange = vscode.workspace.onDidChangeConfiguration((event) => {
		if (event.affectsConfiguration('cp-nice-player.ffmpegPath')) {
			void context.globalState.update(FFMPEG_MISSING_NOTIFIED_KEY, undefined);
			void clearFfmpegCache(context);
			return;
		}

		if (event.affectsConfiguration('cp-nice-player.playback.format')) {
			refreshEncodeFormatResolution();
		}
	});
	context.subscriptions.push(configChange);

	const playbackService = new PlaybackService();
	try {
		await playbackService.ensureStarted();
	} catch (err) {
		console.error('cp-nice-player: playback server failed to start', err);
	}
	context.subscriptions.push(playbackService);

	context.subscriptions.push(
		vscode.window.registerCustomEditorProvider(
			MEDIA_EDITOR_VIEW_TYPE,
			new MediaEditorProvider(context, playbackService),
			{
				webviewOptions: { retainContextWhenHidden: true },
			},
		),
	);

	const openCommand = vscode.commands.registerCommand(
		'cp-nice-player.open',
		async (uri?: vscode.Uri) => {
			let mediaUri = uri;

			if (!mediaUri) {
				const selected = await vscode.window.showOpenDialog({
					canSelectMany: false,
					openLabel: "Open in CP's Nice Player",
					filters: MEDIA_FILE_FILTERS,
				});
				mediaUri = selected?.[0];
			}

			if (!mediaUri) {
				return;
			}

			if (!isSupportedAudio(mediaUri)) {
				void vscode.window.showErrorMessage(
					"CP's Nice Player does not support this file type.",
				);
				return;
			}

			await warmFfmpegAndNotifyOnce(context);

			await vscode.commands.executeCommand(
				'vscode.openWith',
				mediaUri,
				MEDIA_EDITOR_VIEW_TYPE,
			);
		},
	);

	context.subscriptions.push(openCommand);

	const downloadFfmpegCommand = vscode.commands.registerCommand(
		'cp-nice-player.downloadFfmpeg',
		async () => {
			await downloadManagedFfmpeg(context);
		},
	);

	context.subscriptions.push(downloadFfmpegCommand);

	void warmFfmpegAndNotifyOnce(context);
}

export function deactivate(): void {
	// In-memory stream index is cleared in PlaybackServer.start() and dispose().
}
