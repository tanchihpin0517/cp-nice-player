import * as vscode from 'vscode';
import { PlaybackServer } from './playbackServer';

export class PlaybackService implements vscode.Disposable {
	private server: PlaybackServer | undefined;
	private started = false;

	constructor(private readonly context: vscode.ExtensionContext) {}

	async ensureStarted(): Promise<void> {
		if (this.started) {
			return;
		}

		this.server = new PlaybackServer(this.context);
		await this.server.start();
		this.started = true;
	}

	getServer(): PlaybackServer | undefined {
		return this.server;
	}

	dispose(): void {
		this.server?.dispose();
		this.server = undefined;
		this.started = false;
	}
}
