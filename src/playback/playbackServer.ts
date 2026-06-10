import * as http from 'http';
import * as vscode from 'vscode';
import { checkFfmpegAvailable, FfmpegCheckResult } from '../ffmpeg';
import { AudioRegistry } from './audioRegistry';
import { cleanStreamCacheDir } from './streamCache';
import { getOrCreateChunk, ChunkOutOfRangeError } from './streamChunk';
import { getOrCreateIndex } from './streamIndex';
import { resolveStreamContext, AudioNotFoundError, SourceNotFoundError } from './streamResolve';

export class PlaybackServer implements vscode.Disposable {
	private server: http.Server | undefined;
	private listenPromise: Promise<number> | undefined;
	private port: number | undefined;
	private externalUrl: string | undefined;
	private disposed = false;
	private readonly registry = new AudioRegistry();

	constructor(private readonly context: vscode.ExtensionContext) {}

	async start(): Promise<number> {
		if (this.disposed) {
			throw new Error('Playback server was disposed.');
		}

		if (this.port !== undefined) {
			return this.port;
		}

		if (!this.listenPromise) {
			cleanStreamCacheDir(this.context);
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

	async registerAudio(fsPath: string, ffmpeg: FfmpegCheckResult): Promise<string> {
		const audioId = this.registry.registerAudio(fsPath);
		try {
			await getOrCreateIndex(this.context, this.registry, audioId, ffmpeg);
			return audioId;
		} catch (err) {
			this.registry.unregisterAudio(audioId);
			throw err;
		}
	}

	unregisterAudio(audioId: string): void {
		this.registry.unregisterAudio(audioId);
	}

	getServerUrl(): string | undefined {
		return this.externalUrl;
	}

	dispose(): void {
		this.disposed = true;
		this.registry.clear();
		this.server?.close();
		this.server = undefined;
		this.listenPromise = undefined;
		this.port = undefined;
		this.externalUrl = undefined;
		cleanStreamCacheDir(this.context);
	}

	private bindServer(): Promise<number> {
		return new Promise<number>((resolve, reject) => {
			this.server = http.createServer((req, res) => {
				void this.handleRequest(req, res);
			});

			this.server.on('error', reject);
			this.server.listen(0, '127.0.0.1', async () => {
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
				const externalUri = await vscode.env.asExternalUri(
					vscode.Uri.parse(`http://127.0.0.1:${this.port}`),
				);
				this.externalUrl = externalUri.toString(true);
				console.log(
					`cp-nice-player: Playback server started on ${this.externalUrl}.`,
				);
				void vscode.window.showInformationMessage(
					`CP's Nice Player: Playback server started on ${this.externalUrl}.`,
				);
				resolve(this.port);
			});
		});
	}

	private getAllowedOrigin(origin: string | undefined): string | undefined {
		if (!origin) {
			return undefined;
		}
		// Desktop editors: Match vscode-webview://, cursor-webview://, vscodium-webview://, etc.
		if (/^[a-z0-9-]+-webview:\/\//i.test(origin)) {
			return origin;
		}
		// Browser editors (VS Code for the Web, github.dev): Match https://*.vscode-cdn.net
		if (origin.startsWith('https://') && origin.endsWith('.vscode-cdn.net')) {
			return origin;
		}
		return undefined;
	}

	private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
		if (this.disposed) {
			res.writeHead(503, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ error: 'Server is shutting down' }));
			return;
		}

		const origin = req.headers.origin;
		const allowedOrigin = this.getAllowedOrigin(origin);
		if (allowedOrigin) {
			res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
		}
		res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

		if (req.method === 'OPTIONS') {
			res.writeHead(204);
			res.end();
			return;
		}

		const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);

		if (req.method === 'GET' && url.pathname === '/index') {
			await this.handleIndexRoute(url, res);
			return;
		}

		const chunkMatch = url.pathname.match(/^\/chunk\/(\d+)$/);
		if (req.method === 'GET' && chunkMatch) {
			await this.handleChunkRoute(url, Number(chunkMatch[1]), res);
			return;
		}

		res.writeHead(404, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify({ error: 'Not found' }));
	}

	private getAudioId(url: URL): string | undefined {
		const audioId = url.searchParams.get('audioId')?.trim();
		return audioId && audioId.length > 0 ? audioId : undefined;
	}

	private async handleIndexRoute(url: URL, res: http.ServerResponse): Promise<void> {
		const audioId = this.getAudioId(url);
		if (!audioId) {
			res.writeHead(400, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ error: 'Missing or invalid audioId query param' }));
			return;
		}

		try {
			const ffmpeg = await checkFfmpegAvailable();
			if (!ffmpeg.available) {
				throw new Error(ffmpeg.error ?? 'FFmpeg is not available.');
			}

			const index = await getOrCreateIndex(this.context, this.registry, audioId, ffmpeg);
			console.log(`cp-nice-player: index audioId=${audioId} cache=${index.cache}`);
			res.writeHead(200, {
				'Content-Type': 'application/json',
				'X-Cache': index.cache,
			});
			res.end(JSON.stringify(index.manifest));
		} catch (err) {
			this.sendError(res, err, audioId);
		}
	}

	private async handleChunkRoute(
		url: URL,
		chunkIndex: number,
		res: http.ServerResponse,
	): Promise<void> {
		const audioId = this.getAudioId(url);
		if (!audioId) {
			res.writeHead(400, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ error: 'Missing or invalid audioId query param' }));
			return;
		}

		if (!Number.isInteger(chunkIndex) || chunkIndex < 0) {
			res.writeHead(400, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ error: 'Invalid chunk index' }));
			return;
		}

		try {
			const ffmpeg = await checkFfmpegAvailable();
			if (!ffmpeg.available) {
				throw new Error(ffmpeg.error ?? 'FFmpeg is not available.');
			}

			const streamCtx = await resolveStreamContext(this.registry, this.context, audioId);
			const index = await getOrCreateIndex(this.context, this.registry, audioId, ffmpeg);
			const chunk = await getOrCreateChunk(
				streamCtx,
				ffmpeg,
				chunkIndex,
				index.manifest,
			);

			console.log(
				`cp-nice-player: chunk ${chunk.index} audioId=${audioId} cache=${chunk.cache}`,
			);
			res.writeHead(200, {
				'Content-Type': chunk.contentType,
				'Content-Length': chunk.buffer.length,
				'X-Cache': chunk.cache,
				'X-Chunk-Index': String(chunk.index),
				'X-Chunk-Start-Sec': String(chunk.startSec),
				'X-Chunk-Duration-Sec': String(chunk.durationSec),
			});
			res.end(chunk.buffer);
		} catch (err) {
			this.sendError(res, err, audioId);
		}
	}

	private sendError(res: http.ServerResponse, err: unknown, audioId: string): void {
		if (err instanceof AudioNotFoundError || err instanceof SourceNotFoundError) {
			res.writeHead(404, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ error: err.message }));
			return;
		}

		if (err instanceof ChunkOutOfRangeError) {
			res.writeHead(404, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ error: err.message }));
			return;
		}

		const message = err instanceof Error ? err.message : String(err);
		console.error(`cp-nice-player: request failed for audioId=${audioId}`, err);
		res.writeHead(500, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify({ error: message }));
	}
}
