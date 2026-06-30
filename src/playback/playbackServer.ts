import * as http from 'http';
import * as vscode from 'vscode';
import { getDebugLogging, getPlaybackFormat, getPlaybackOggQuality } from '../config';
import { checkFfmpegAvailable, FfmpegCheckResult } from '../ffmpegHost';
import { formatFfmpegChunkCommandTemplate } from './stream/ffmpegChunk';
import { cleanStreamCacheDir } from './stream/cache';
import { registerAudio as registerStreamAudio, RegisterResult } from './stream/registrar';
import { Registry } from './stream/registry';
import { createRouteHandlers, matchRoute } from './stream/routes';

export class PlaybackServer implements vscode.Disposable {
	private server: http.Server | undefined;
	private listenPromise: Promise<number> | undefined;
	private port: number | undefined;
	private externalUrl: string | undefined;
	private disposed = false;
	private readonly registry = new Registry();
	private readonly routeHandlers: ReturnType<typeof createRouteHandlers>;

	constructor(private readonly context: vscode.ExtensionContext) {
		this.routeHandlers = createRouteHandlers(this.registry, this.context);
	}

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

	async registerAudio(fsPath: string, ffmpeg: FfmpegCheckResult): Promise<RegisterResult> {
		return registerStreamAudio(this.context, this.registry, fsPath, ffmpeg);
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
		cleanStreamCacheDir(this.context);
		this.server?.close();
		this.server = undefined;
		this.listenPromise = undefined;
		this.port = undefined;
		this.externalUrl = undefined;
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
				if (getDebugLogging()) {
					const ffmpeg = await checkFfmpegAvailable();
					console.log(
						`cp-nice-player: chunk transcode template: ${formatFfmpegChunkCommandTemplate(ffmpeg.path, {
							format: getPlaybackFormat(),
							oggQuality: getPlaybackOggQuality(),
						})}`,
					);
				}
				resolve(this.port);
			});
		});
	}

	private getAllowedOrigin(origin: string | undefined): string | undefined {
		if (!origin) {
			return undefined;
		}
		if (/^[a-z0-9-]+-webview:\/\//i.test(origin)) {
			return origin;
		}
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
		const handler = matchRoute(this.routeHandlers, url.pathname);

		if (req.method === 'GET' && handler) {
			await handler(req, res, url);
			return;
		}

		res.writeHead(404, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify({ error: 'Not found' }));
	}
}
