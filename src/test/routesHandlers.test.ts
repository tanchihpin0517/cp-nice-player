import * as assert from 'assert';
import * as path from 'path';
import { checkFfmpegAvailable } from '../ffmpegHost';
import { clearStreamIndexCache } from '../playback/stream/indexBuilder';
import { Registry } from '../playback/stream/registry';
import { createRouteHandlers, matchRoute } from '../playback/stream/routes';
import {
	createCollectingResponse,
	createMockRequest,
} from './helpers/httpTestHelpers';
import {
	createTempWorkDir,
	generateTestInputWav,
	removeTempWorkDir,
	requireFfmpeg,
} from './helpers/ffmpegTestHelpers';

suite('Route handlers', () => {
	let ffmpegPath: string;
	let workDir: string;
	let inputPath: string;
	let audioId: string;
	let handlers: ReturnType<typeof createRouteHandlers>;

	suiteSetup(async function () {
		try {
			ffmpegPath = await requireFfmpeg();
		} catch {
			this.skip();
			return;
		}

		await checkFfmpegAvailable(true);
		workDir = await createTempWorkDir('cp-nice-player-routes-');
		inputPath = path.join(workDir, 'input.wav');
		await generateTestInputWav(ffmpegPath, inputPath);

		const registry = new Registry();
		handlers = createRouteHandlers(registry);
		audioId = registry.registerAudio(inputPath);
	});

	suiteTeardown(async () => {
		clearStreamIndexCache();
		await removeTempWorkDir(workDir);
	});

	async function invokeHandler(pathname: string, query = '') {
		const url = new URL(`http://127.0.0.1${pathname}${query}`);
		const handler = matchRoute(handlers, url.pathname);
		assert.ok(handler);
		const { res, result } = createCollectingResponse();
		await handler(createMockRequest(url.pathname + url.search), res, url);
		return result();
	}

	test('index handler returns 400 when audioId missing', async () => {
		const response = await invokeHandler('/index');
		assert.strictEqual(response.statusCode, 400);
		assert.match(response.body.toString('utf8'), /audioId/);
	});

	test('index handler returns 404 for unknown audioId', async () => {
		const response = await invokeHandler('/index', '?audioId=deadbeef');
		assert.strictEqual(response.statusCode, 404);
	});

	test('index handler returns manifest for valid audioId', async () => {
		const response = await invokeHandler('/index', `?audioId=${audioId}`);
		assert.strictEqual(response.statusCode, 200);
		const manifest = JSON.parse(response.body.toString('utf8'));
		assert.strictEqual(manifest.version, 1);
		assert.ok(manifest.chunking.count >= 1);
	});

	test('chunk handler returns 400 for invalid index', async () => {
		const handler = handlers.get('/chunk/:index');
		assert.ok(handler);
		const { res, result } = createCollectingResponse();
		const url = new URL(`http://127.0.0.1/chunk/foo?audioId=${audioId}`);
		await handler(createMockRequest(url.pathname + url.search), res, url);
		const response = await result();
		assert.strictEqual(response.statusCode, 400);
	});

	test('chunk handler returns transcoded bytes for valid request', async () => {
		const handler = handlers.get('/chunk/:index');
		assert.ok(handler);
		const { res, result } = createCollectingResponse();
		const url = new URL(`http://127.0.0.1/chunk/0?audioId=${audioId}`);
		await handler(createMockRequest(url.pathname + url.search), res, url);
		const response = await result();

		assert.strictEqual(response.statusCode, 200);
		assert.ok(response.body.length > 0);
		assert.ok(String(response.headers['content-type']).startsWith('audio/'));
		assert.strictEqual(response.headers['x-chunk-index'], '0');
	});

	test('chunk handler returns 404 for out-of-range index', async () => {
		const handler = handlers.get('/chunk/:index');
		assert.ok(handler);
		const { res, result } = createCollectingResponse();
		const url = new URL(`http://127.0.0.1/chunk/999?audioId=${audioId}`);
		await handler(createMockRequest(url.pathname + url.search), res, url);
		const response = await result();
		assert.strictEqual(response.statusCode, 404);
	});
});
