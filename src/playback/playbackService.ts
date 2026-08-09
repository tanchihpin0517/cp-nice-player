import * as vscode from 'vscode';
import { checkFfmpegAvailable, getEffectiveEncodeFormat } from '../ffmpegHost';
import { PlaybackServer } from './playbackServer';
import { PlaybackServerStatus } from './serverStatus';

export class PlaybackService implements vscode.Disposable {
	private server: PlaybackServer | undefined;
	private started = false;

	async ensureStarted(): Promise<void> {
		if (this.started) {
			return;
		}

		this.server = new PlaybackServer();
		await this.server.start();
		this.started = true;
	}

	getServer(): PlaybackServer | undefined {
		return this.server;
	}

	/**
	 * Full server picture for the webview. Reported over the extension's postMessage channel, so
	 * it reaches the player even when the player cannot reach the HTTP server.
	 */
	async getStatus(): Promise<PlaybackServerStatus> {
		const ffmpeg = await checkFfmpegAvailable();
		const server = this.server;

		if (!server) {
			return {
				state: 'stopped',
				urlForwarded: false,
				registeredAudioCount: 0,
				ffmpeg: {
					available: ffmpeg.available,
					path: ffmpeg.path,
					version: ffmpeg.version,
					encodeFormat: ffmpeg.available ? getEffectiveEncodeFormat() : undefined,
					error: ffmpeg.error,
				},
			};
		}

		const status = server.getStatus(ffmpeg);
		return { ...status, hostReachable: await server.probeSelf() };
	}

	/**
	 * Tears down the server and starts a fresh one on a new port. All audio registrations are
	 * dropped, so callers must re-register whatever they still need.
	 */
	async restart(): Promise<void> {
		this.server?.dispose();
		this.server = undefined;
		this.started = false;
		await this.ensureStarted();
	}

	dispose(): void {
		this.server?.dispose();
		this.server = undefined;
		this.started = false;
	}
}
