import * as vscode from 'vscode';
import { PlaybackService } from '../playback/playbackService';
import { WebviewPlayerSession } from './playerSession';
import { PlayerSession } from './types';

export { isSupportedAudio, MEDIA_FILE_FILTERS } from '../mediaTypes';
export { getResourceRoots } from './playerSession';

export function createPlayerSession(
	panel: vscode.WebviewPanel,
	extensionUri: vscode.Uri,
	resourceRoots: vscode.Uri[],
	context: vscode.ExtensionContext,
	playbackService: PlaybackService,
): PlayerSession {
	return new WebviewPlayerSession(panel, extensionUri, resourceRoots, context, playbackService);
}
