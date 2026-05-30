import * as vscode from 'vscode';

export type UnsupportedPlayback = 'cache' | 'stream';

export function getUnsupportedPlayback(): UnsupportedPlayback {
	return vscode.workspace
		.getConfiguration('cp-nice-player')
		.get<UnsupportedPlayback>('unsupportedPlayback', 'cache');
}
