import * as http from 'http';
import * as vscode from 'vscode';
import { getDebugLogging, getPlaybackOggQuality } from '../config';
import { checkFfmpegAvailable, FfmpegCheckResult, getEffectiveEncodeFormat } from '../ffmpegHost';
import { formatFfmpegChunkCommandTemplate } from './stream/ffmpegChunk';
import { clearStreamIndexCache } from './stream/indexBuilder';
import { registerAudio as registerStreamAudio } from './stream/registrar';
import { Registry } from './stream/registry';
import { createRouteHandlers, matchRoute } from './stream/routes';
import {
	HostReachability,
	localUrlForPort,
	PlaybackServerState,
	PlaybackServerStatus,
} from './serverStatus';

const SELF_PROBE_TIMEOUT_MS = 2000;

export class PlaybackServer implements vscode.Disposable {
	private server: http.Server | undefined;
	private listenPromise: Promise<number> | undefined;
	private port: number | undefined;
	private externalUrl: string | undefined;
	private disposed = false;
	private state: PlaybackServerState = 'stopped';
	private lastError: string | undefined;
	private startedAt: number | undefined;
	private readonly registry = new Registry();
	private readonly routeHandlers: ReturnType<typeof createRouteHandlers>;

	constructor() {
		this.routeHandlers = createRouteHandlers(this.registry);
	}

	async start(): Promise<number> {
		if (this.disposed) {
			throw new Error('Playback server was disposed.');
		}

		if (this.port !== undefined) {
			return this.port;
		}

		if (!this.listenPromise) {
			clearStreamIndexCache();
			this.state = 'starting';
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
			this.state = 'failed';
			this.lastError = message;
			console.error('cp-nice-player: failed to start playback server', err);
			void vscode.window.showErrorMessage(
				`CP's Nice Player: Playback server failed to start. ${message}`,
			);
			this.listenPromise = undefined;
			throw err;
		}
	}

	async registerAudio(fsPath: string, ffmpeg: FfmpegCheckResult) {
		return registerStreamAudio(this.registry, fsPath, ffmpeg);
	}

	unregisterAudio(audioId: string): void {
		this.registry.unregisterAudio(audioId);
	}

	getServerUrl(): string | undefined {
		return this.externalUrl;
	}

	getStatus(ffmpeg: FfmpegCheckResult): PlaybackServerStatus {
		const localUrl = this.port !== undefined ? localUrlForPort(this.port) : undefined;

		return {
			state: this.state,
			port: this.port,
			localUrl,
			externalUrl: this.externalUrl,
			urlForwarded: Boolean(localUrl && this.externalUrl && this.externalUrl !== localUrl),
			registeredAudioCount: this.registry.size(),
			startedAt: this.startedAt,
			lastError: this.lastError,
			ffmpeg: {
				available: ffmpeg.available,
				path: ffmpeg.path,
				version: ffmpeg.version,
				encodeFormat: ffmpeg.available ? getEffectiveEncodeFormat() : undefined,
				error: ffmpeg.error,
			},
		};
	}

	/**
	 * Requests /health from the extension host itself. This bypasses the webview entirely, so a
	 * failure here means the server is genuinely down rather than merely unreachable from the
	 * webview (forwarded URL, CSP, tunnel).
	 */
	probeSelf(timeoutMs = SELF_PROBE_TIMEOUT_MS): Promise<HostReachability> {
		const startedAt = Date.now();

		if (this.disposed || this.port === undefined) {
			return Promise.resolve({
				ok: false,
				error: this.disposed ? 'Playback server was disposed.' : 'Playback server is not listening.',
				checkedAt: startedAt,
			});
		}

		const url = `${localUrlForPort(this.port)}/health`;

		return new Promise<HostReachability>((resolve) => {
			let settled = false;
			const finish = (result: Omit<HostReachability, 'checkedAt' | 'elapsedMs'>) => {
				if (settled) {
					return;
				}
				settled = true;
				resolve({
					...result,
					elapsedMs: Date.now() - startedAt,
					checkedAt: startedAt,
				});
			};

			const request = http.get(url, { timeout: timeoutMs }, (res) => {
				const httpStatus = res.statusCode ?? 0;
				res.resume();
				res.on('end', () => {
					finish({ ok: httpStatus >= 200 && httpStatus < 300, httpStatus });
				});
			});

			request.on('timeout', () => {
				request.destroy();
				finish({ ok: false, error: `Timed out after ${timeoutMs}ms.` });
			});

			request.on('error', (err) => {
				finish({ ok: false, error: err instanceof Error ? err.message : String(err) });
			});
		});
	}

	dispose(): void {
		this.disposed = true;
		this.state = 'disposed';
		this.startedAt = undefined;
		this.registry.clear();
		clearStreamIndexCache();
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
					vscode.Uri.parse(localUrlForPort(this.port)),
				);
				this.externalUrl = externalUri.toString(true);
				this.state = 'listening';
				this.startedAt = Date.now();
				this.lastError = undefined;
				console.log(
					`cp-nice-player: Playback server started on ${this.externalUrl}.`,
				);
				if (getDebugLogging()) {
					const ffmpeg = await checkFfmpegAvailable();
					console.log(
						`cp-nice-player: chunk transcode template: ${formatFfmpegChunkCommandTemplate(ffmpeg.path, {
							format: getEffectiveEncodeFormat(),
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
