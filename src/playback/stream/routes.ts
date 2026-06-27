import * as http from 'http';
import * as vscode from 'vscode';
import { getDebugLogging } from '../../config';
import { checkFfmpegAvailable, FfmpegCheckResult } from '../../ffmpegHost';
import { Registry } from './registry';
import { getOrCreateChunk, ChunkOutOfRangeError } from './chunk';
import { getOrCreateIndex } from './indexBuilder';
import { resolveStreamContext, AudioNotFoundError, SourceNotFoundError, StreamContext } from './resolve';

export type RouteHandler = (
	req: http.IncomingMessage,
	res: http.ServerResponse,
	url: URL,
) => Promise<void>;

function getAudioId(url: URL): string | undefined {
	const audioId = url.searchParams.get('audioId')?.trim();
	return audioId && audioId.length > 0 ? audioId : undefined;
}

function sendError(res: http.ServerResponse, err: unknown, audioId: string): void {
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
	console.error(`cp-nice-player: stream request failed for audioId=${audioId}`, err);
	res.writeHead(500, { 'Content-Type': 'application/json' });
	res.end(JSON.stringify({ error: message }));
}

type AudioRouteHandler = (
	res: http.ServerResponse,
	audioId: string,
	ffmpeg: FfmpegCheckResult,
	streamCtx: StreamContext,
	url: URL,
) => Promise<void>;

function withAudio(
	registry: Registry,
	context: vscode.ExtensionContext,
	handler: AudioRouteHandler,
): RouteHandler {
	return async (_req, res, url) => {
		const audioId = getAudioId(url);
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

			const streamCtx = await resolveStreamContext(registry, context, audioId);
			await handler(res, audioId, ffmpeg, streamCtx, url);
		} catch (err) {
			sendError(res, err, audioId);
		}
	};
}

export function createRouteHandlers(
	registry: Registry,
	context: vscode.ExtensionContext,
): Map<string, RouteHandler> {
	const handlers = new Map<string, RouteHandler>();

	handlers.set(
		'/index',
		withAudio(registry, context, async (res, audioId, ffmpeg, streamCtx, _url) => {
			const index = await getOrCreateIndex(streamCtx, ffmpeg);
			if (getDebugLogging()) {
				console.log(`cp-nice-player: index audioId=${audioId} cache=${index.cache}`);
			}
			res.writeHead(200, {
				'Content-Type': 'application/json',
				'X-Cache': index.cache,
			});
			res.end(JSON.stringify(index.manifest));
		}),
	);

	handlers.set(
		'/chunk/:index',
		withAudio(registry, context, async (res, audioId, ffmpeg, streamCtx, url) => {
			const chunkMatch = url.pathname.match(/^\/chunk\/(\d+)$/);
			const chunkIndex = chunkMatch ? Number(chunkMatch[1]) : NaN;
			if (!Number.isInteger(chunkIndex) || chunkIndex < 0) {
				res.writeHead(400, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ error: 'Invalid chunk index' }));
				return;
			}

			const index = await getOrCreateIndex(streamCtx, ffmpeg);
			const chunk = await getOrCreateChunk(streamCtx, ffmpeg, chunkIndex, index.manifest);

			if (getDebugLogging()) {
				console.log(
					`cp-nice-player: chunk ${chunk.index} audioId=${audioId} cache=${chunk.cache}`,
				);
			}
			res.writeHead(200, {
				'Content-Type': chunk.contentType,
				'Content-Length': chunk.buffer.length,
				'X-Cache': chunk.cache,
				'X-Chunk-Index': String(chunk.index),
				'X-Chunk-Start-Sec': String(chunk.startSec),
				'X-Chunk-Duration-Sec': String(chunk.durationSec),
			});
			res.end(chunk.buffer);
		}),
	);

	return handlers;
}

export function matchRoute(
	handlers: Map<string, RouteHandler>,
	pathname: string,
): RouteHandler | undefined {
	if (handlers.has(pathname)) {
		return handlers.get(pathname);
	}
	if (/^\/chunk\/\d+$/.test(pathname)) {
		return handlers.get('/chunk/:index');
	}
	return undefined;
}
