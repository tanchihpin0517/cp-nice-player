import * as fs from 'fs';
import * as http from 'http';
import * as vscode from 'vscode';
import { PlaybackFormat } from '../config';
import { FfmpegCheckResult } from '../ffmpeg';
import { ensureTranscodedAudio } from './transcode';

export interface PlaybackResult {
	playbackUrl: string;
	transcodedFsPath: string;
	transcodedFileName: string;
	format: PlaybackFormat;
}

function contentTypeForFormat(format: PlaybackFormat): string {
	return format === 'flac' ? 'audio/flac' : 'audio/ogg';
}

export class PlaybackServer implements vscode.Disposable {
	private server: http.Server | undefined;
	private listenPromise: Promise<number> | undefined;
	private port: number | undefined;
	private disposed = false;
	private prepareInFlight: Promise<PlaybackResult> | undefined;
	private preparedFilePath: string | undefined;
	private preparedFormat: PlaybackFormat | undefined;

	constructor(private readonly context: vscode.ExtensionContext) {}

	async start(): Promise<number> {
		if (this.disposed) {
			throw new Error('Playback server was disposed.');
		}

		if (this.port !== undefined) {
			return this.port;
		}

		if (!this.listenPromise) {
			this.listenPromise = this.bindServer();
		}

		try {
			const port = await this.listenPromise;
			if (this.disposed) {
				throw new Error('Playback server was disposed during startup.');
			}
			return port;
		} catch (err) {
			if (this.disposed) {
				throw err;
			}
			const message = err instanceof Error ? err.message : String(err);
			console.error('cp-nice-player: failed to start playback server', err);
			void vscode.window.showErrorMessage(
				`CP's Nice Player: Playback server failed to start. ${message}`,
			);
			this.listenPromise = undefined;
			throw err;
		}
	}

	private bindServer(): Promise<number> {
		return new Promise<number>((resolve, reject) => {
			this.server = http.createServer((req, res) => {
				void this.handleRequest(req, res);
			});

			this.server.on('error', reject);
			this.server.listen(0, '127.0.0.1', () => {
				if (this.disposed) {
					reject(new Error('Playback server was disposed during startup.'));
					return;
				}

				const address = this.server?.address();
				if (!address || typeof address === 'string') {
					reject(new Error('Failed to bind playback server.'));
					return;
				}

				this.port = address.port;
				console.log(
					`cp-nice-player: Playback server started on 127.0.0.1:${this.port}.`,
				);
				void vscode.window.showInformationMessage(
					`CP's Nice Player: Playback server started on 127.0.0.1:${this.port}.`,
				);
				resolve(this.port);
			});
		});
	}

	async preparePlayback(
		mediaUri: vscode.Uri,
		ffmpeg: FfmpegCheckResult,
		signal?: AbortSignal,
	): Promise<PlaybackResult> {
		if (this.prepareInFlight) {
			return this.prepareInFlight;
		}

		this.prepareInFlight = this.runPrepare(mediaUri, ffmpeg, signal);
		try {
			return await this.prepareInFlight;
		} finally {
			this.prepareInFlight = undefined;
		}
	}

	getPlaybackUrl(): string | undefined {
		if (this.port === undefined) {
			return undefined;
		}
		return `http://127.0.0.1:${this.port}/audio`;
	}

	dispose(): void {
		this.disposed = true;
		this.prepareInFlight = undefined;
		this.preparedFilePath = undefined;
		this.preparedFormat = undefined;
		this.server?.close();
		this.server = undefined;
		this.listenPromise = undefined;
		this.port = undefined;
	}

	private async runPrepare(
		mediaUri: vscode.Uri,
		ffmpeg: FfmpegCheckResult,
		signal?: AbortSignal,
	): Promise<PlaybackResult> {
		await this.ensureListening();
		const transcoded = await ensureTranscodedAudio(this.context, mediaUri, ffmpeg, signal);

		this.preparedFilePath = transcoded.fsPath;
		this.preparedFormat = transcoded.format;

		const playbackUrl = this.getPlaybackUrl();
		if (!playbackUrl) {
			throw new Error('Playback server is not listening.');
		}

		return {
			playbackUrl,
			transcodedFsPath: transcoded.fsPath,
			transcodedFileName: transcoded.fileName,
			format: transcoded.format,
		};
	}

	private async ensureListening(): Promise<number> {
		return this.start();
	}

	private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
		res.setHeader('Access-Control-Allow-Origin', '*');
		res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

		if (req.method === 'OPTIONS') {
			res.writeHead(204);
			res.end();
			return;
		}

		const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);

		if (req.method === 'GET' && url.pathname === '/audio') {
			await this.handleAudioRoute(res);
			return;
		}

		res.writeHead(404, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify({ error: 'Not found' }));
	}

	private async handleAudioRoute(res: http.ServerResponse): Promise<void> {
		if (!this.preparedFilePath || !this.preparedFormat) {
			res.writeHead(404, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ error: 'No prepared audio available' }));
			return;
		}

		try {
			const stat = await fs.promises.stat(this.preparedFilePath);
			res.writeHead(200, {
				'Content-Type': contentTypeForFormat(this.preparedFormat),
				'Content-Length': stat.size,
			});
			fs.createReadStream(this.preparedFilePath).pipe(res);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			res.writeHead(500, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ error: message }));
		}
	}
}
