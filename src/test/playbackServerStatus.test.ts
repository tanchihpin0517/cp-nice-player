import * as assert from 'assert';
import { FfmpegCheckResult } from '../ffmpegHost';
import { PlaybackServer } from '../playback/playbackServer';
import { clearStreamIndexCache } from '../playback/stream/indexBuilder';

const FFMPEG_OK: FfmpegCheckResult = {
	available: true,
	path: '/usr/bin/ffmpeg',
	version: 'ffmpeg version test',
};

const FFMPEG_MISSING: FfmpegCheckResult = {
	available: false,
	path: 'ffmpeg',
	error: 'ffmpeg was not found on PATH.',
};

suite('Playback server status', () => {
	let server: PlaybackServer | undefined;

	teardown(() => {
		server?.dispose();
		server = undefined;
		clearStreamIndexCache();
	});

	test('reports stopped before start', () => {
		server = new PlaybackServer();
		const status = server.getStatus(FFMPEG_OK);

		assert.strictEqual(status.state, 'stopped');
		assert.strictEqual(status.port, undefined);
		assert.strictEqual(status.urlForwarded, false);
		assert.strictEqual(status.registeredAudioCount, 0);
		assert.strictEqual(status.ffmpeg.available, true);
	});

	test('reports listening with port and urls after start', async () => {
		server = new PlaybackServer();
		const port = await server.start();
		const status = server.getStatus(FFMPEG_OK);

		assert.strictEqual(status.state, 'listening');
		assert.strictEqual(status.port, port);
		assert.strictEqual(status.localUrl, `http://127.0.0.1:${port}`);
		assert.ok(status.externalUrl);
		assert.ok(status.startedAt && status.startedAt > 0);
		assert.strictEqual(status.lastError, undefined);
	});

	test('carries ffmpeg failure detail without changing server state', async () => {
		server = new PlaybackServer();
		await server.start();
		const status = server.getStatus(FFMPEG_MISSING);

		assert.strictEqual(status.state, 'listening');
		assert.strictEqual(status.ffmpeg.available, false);
		assert.strictEqual(status.ffmpeg.error, FFMPEG_MISSING.error);
		assert.strictEqual(status.ffmpeg.encodeFormat, undefined);
	});

	test('reports disposed after dispose', async () => {
		server = new PlaybackServer();
		await server.start();
		server.dispose();

		assert.strictEqual(server.getStatus(FFMPEG_OK).state, 'disposed');
	});

	test('probeSelf succeeds against a live server', async () => {
		server = new PlaybackServer();
		await server.start();
		const reachable = await server.probeSelf();

		assert.strictEqual(reachable.ok, true);
		assert.strictEqual(reachable.httpStatus, 200);
		assert.ok(typeof reachable.elapsedMs === 'number');
		assert.ok(reachable.checkedAt > 0);
	});

	test('probeSelf reports failure when not started', async () => {
		server = new PlaybackServer();
		const reachable = await server.probeSelf();

		assert.strictEqual(reachable.ok, false);
		assert.match(String(reachable.error), /not listening/);
	});

	test('probeSelf reports failure after dispose', async () => {
		server = new PlaybackServer();
		await server.start();
		server.dispose();

		const reachable = await server.probeSelf();
		assert.strictEqual(reachable.ok, false);
		assert.ok(reachable.error);
	});
});
