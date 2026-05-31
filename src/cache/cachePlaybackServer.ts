import * as http from 'http';
import * as vscode from 'vscode';
import { CacheFormat } from '../config';
import { FfmpegCheckResult } from '../ffmpeg';
import { ensureCachedAudio } from './transcodeCache';

export interface CachePlaybackResult {
	playbackUri: vscode.Uri;
	cacheFsPath: string;
	cacheFileName: string;
	format: CacheFormat;
}

export class CachePlaybackServer implements vscode.Disposable {
	private server: http.Server | undefined;
	private listenPromise: Promise<number> | undefined;
	private port: number | undefined;
	private currentMediaUri: vscode.Uri | undefined;
	private currentFfmpeg: FfmpegCheckResult | undefined;
	private currentSignal: AbortSignal | undefined;
	private prepareInFlight: Promise<CachePlaybackResult> | undefined;

	constructor(private readonly context: vscode.ExtensionContext) {}

	async preparePlayback(
		mediaUri: vscode.Uri,
		ffmpeg: FfmpegCheckResult,
		signal?: AbortSignal,
	): Promise<CachePlaybackResult> {
		if (this.prepareInFlight) {
			return this.prepareInFlight;
		}

		this.currentMediaUri = mediaUri;
		this.currentFfmpeg = ffmpeg;
		this.currentSignal = signal;

		await this.ensureListening();

		this.prepareInFlight = this.runPrepare(mediaUri, ffmpeg, signal);
		try {
			return await this.prepareInFlight;
		} finally {
			this.prepareInFlight = undefined;
		}
	}

	dispose(): void {
		this.prepareInFlight = undefined;
		this.server?.close();
		this.server = undefined;
		this.listenPromise = undefined;
		this.port = undefined;
	}

	private async runPrepare(
		mediaUri: vscode.Uri,
		ffmpeg: FfmpegCheckResult,
		signal?: AbortSignal,
	): Promise<CachePlaybackResult> {
		const cached = await ensureCachedAudio(this.context, mediaUri, ffmpeg, signal);

		return {
			playbackUri: vscode.Uri.file(cached.fsPath),
			cacheFsPath: cached.fsPath,
			cacheFileName: cached.fileName,
			format: cached.format,
		};
	}

	private async ensureListening(): Promise<number> {
		if (this.port !== undefined) {
			return this.port;
		}

		if (!this.listenPromise) {
			this.listenPromise = new Promise<number>((resolve, reject) => {
				this.server = http.createServer((req, res) => {
					void this.handleRequest(req, res);
				});

				this.server.on('error', reject);
				this.server.listen(0, '127.0.0.1', () => {
					const address = this.server?.address();
					if (!address || typeof address === 'string') {
						reject(new Error('Failed to bind cache playback server.'));
						return;
					}
					this.port = address.port;
					resolve(address.port);
				});
			});
		}

		return this.listenPromise;
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

		if (req.method === 'GET' && url.pathname === '/prepare') {
			await this.handlePrepareRoute(res);
			return;
		}

		res.writeHead(404, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify({ error: 'Not found' }));
	}

	private async handlePrepareRoute(res: http.ServerResponse): Promise<void> {
		if (this.prepareInFlight) {
			res.writeHead(409, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ error: 'Transcode already in progress' }));
			return;
		}

		if (!this.currentMediaUri || !this.currentFfmpeg) {
			res.writeHead(400, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ error: 'No media registered for prepare' }));
			return;
		}

		this.prepareInFlight = this.runPrepare(
			this.currentMediaUri,
			this.currentFfmpeg,
			this.currentSignal,
		);

		try {
			const result = await this.prepareInFlight;
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ source: result.playbackUri.toString() }));
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			res.writeHead(500, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ error: message }));
		} finally {
			this.prepareInFlight = undefined;
		}
	}
}
