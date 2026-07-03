import * as assert from 'assert';
import * as path from 'path';
import { checkFfmpegAvailable } from '../ffmpegHost';
import { PlaybackServer } from '../playback/playbackServer';
import { clearStreamIndexCache } from '../playback/stream/indexBuilder';
import { httpGet } from './helpers/httpTestHelpers';
import {
	createTempWorkDir,
	generateTestInputWav,
	removeTempWorkDir,
	requireFfmpeg,
} from './helpers/ffmpegTestHelpers';

suite('Playback server', () => {
	let ffmpegPath: string;
	let workDir: string;
	let inputPath: string;
	let server: PlaybackServer;
	let port: number;
	let audioId: string;

	suiteSetup(async function () {
		try {
			ffmpegPath = await requireFfmpeg();
		} catch {
			this.skip();
			return;
		}

		const ffmpeg = await checkFfmpegAvailable(true);
		workDir = await createTempWorkDir('cp-nice-player-server-');
		inputPath = path.join(workDir, 'input.wav');
		await generateTestInputWav(ffmpegPath, inputPath);

		server = new PlaybackServer();
		port = await server.start();
		assert.ok(server.getServerUrl());

		const registration = await server.registerAudio(inputPath, ffmpeg);
		audioId = registration.audioId;
	});

	suiteTeardown(async () => {
		server?.dispose();
		clearStreamIndexCache();
		await removeTempWorkDir(workDir);
	});

	test('start returns bound port', () => {
		assert.ok(port > 0);
	});

	test('GET /index returns manifest', async () => {
		const response = await httpGet(port, `/index?audioId=${audioId}`);
		assert.strictEqual(response.statusCode, 200);
		const manifest = JSON.parse(response.body.toString('utf8'));
		assert.strictEqual(manifest.version, 1);
	});

	test('GET /chunk/0 returns audio bytes', async () => {
		const response = await httpGet(port, `/chunk/0?audioId=${audioId}`);
		assert.strictEqual(response.statusCode, 200);
		assert.ok(response.body.length > 0);
		assert.ok(String(response.headers['content-type']).startsWith('audio/'));
	});

	test('OPTIONS returns 204', async () => {
		const response = await httpGet(port, `/index?audioId=${audioId}`, { method: 'OPTIONS' });
		assert.strictEqual(response.statusCode, 204);
	});

	test('sets Access-Control-Allow-Origin for vscode-cdn origin', async () => {
		const response = await httpGet(port, `/index?audioId=${audioId}`, {
			origin: 'https://foo.vscode-cdn.net',
		});
		assert.strictEqual(response.headers['access-control-allow-origin'], 'https://foo.vscode-cdn.net');
	});

	test('unknown path returns 404', async () => {
		const response = await httpGet(port, '/unknown');
		assert.strictEqual(response.statusCode, 404);
	});

	test('dispose closes server and rejects new connections', async () => {
		server.dispose();
		try {
			await httpGet(port, `/index?audioId=${audioId}`);
			assert.fail('Expected connection to fail after dispose');
		} catch (err) {
			assert.ok(err);
		}
	});

	test('start throws after dispose', async () => {
		const disposedServer = new PlaybackServer();
		disposedServer.dispose();
		await assert.rejects(() => disposedServer.start(), /disposed/);
	});
});
