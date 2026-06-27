import * as vscode from 'vscode';
import type { PlaybackFormat } from '../config';
import { FfmpegCheckResult } from '../ffmpegHost';

export interface LoadMediaMessage {
	type: 'loadMedia';
	name: string;
	serverUrl: string;
	audioId: string;
	debug: {
		fsPath: string;
		playbackFormat: PlaybackFormat;
		playbackOggQuality: number;
		chunkDurationSec: number;
		chunkBufferCount: number;
		ffmpeg: {
			available: boolean;
			path: string;
			version?: string;
			error?: string;
		};
	};
}

export interface PlayerSession extends vscode.Disposable {
	loadMedia(mediaUri: vscode.Uri, ffmpeg: FfmpegCheckResult): void;
}
