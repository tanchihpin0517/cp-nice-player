import * as vscode from 'vscode';
import {
	clearFfmpegCache,
	FFMPEG_MISSING_NOTIFIED_KEY,
	warmFfmpegAndNotifyOnce,
} from './ffmpeg';
import { MEDIA_EDITOR_VIEW_TYPE, MediaEditorProvider } from './mediaEditorProvider';
import { isSupportedAudio, MEDIA_FILE_FILTERS } from './mediaTypes';
import { cleanTranscodeDir } from './playback/transcode';
import { PlaybackService } from './playback/playbackService';

let extensionContext: vscode.ExtensionContext | undefined;

export async function activate(context: vscode.ExtensionContext) {
	extensionContext = context;
	void cleanTranscodeDir(context);
	const configChange = vscode.workspace.onDidChangeConfiguration((event) => {
		if (event.affectsConfiguration('cp-nice-player.ffmpegPath')) {
			void context.globalState.update(FFMPEG_MISSING_NOTIFIED_KEY, undefined);
			void clearFfmpegCache(context);
		}
	});
	context.subscriptions.push(configChange);

	const playbackService = new PlaybackService(context);
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

	void warmFfmpegAndNotifyOnce(context);
}

export async function deactivate(): Promise<void> {
	if (extensionContext) {
		await cleanTranscodeDir(extensionContext);
		extensionContext = undefined;
	}
}
