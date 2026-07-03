import * as vscode from 'vscode';
import { FfmpegCheckResult } from '../ffmpegHost';

export interface PlayerSession extends vscode.Disposable {
	loadMedia(mediaUri: vscode.Uri, ffmpeg: FfmpegCheckResult): void;
}
