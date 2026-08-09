import * as assert from 'assert';
import { createRouteHandlers, matchRoute } from '../playback/stream/routes';
import { Registry } from '../playback/stream/registry';
import { createCollectingResponse, createMockRequest } from './helpers/httpTestHelpers';

suite('Route matching', () => {
	const handlers = createRouteHandlers(new Registry());

	test('matches /index exactly', () => {
		assert.ok(matchRoute(handlers, '/index'));
	});

	test('matches /health exactly', () => {
		assert.ok(matchRoute(handlers, '/health'));
	});

	test('matches parameterized chunk routes', () => {
		assert.ok(matchRoute(handlers, '/chunk/0'));
		assert.ok(matchRoute(handlers, '/chunk/42'));
	});

	test('rejects unknown paths', () => {
		assert.strictEqual(matchRoute(handlers, '/audio'), undefined);
		assert.strictEqual(matchRoute(handlers, '/chunk/foo'), undefined);
		assert.strictEqual(matchRoute(handlers, '/chunk/-1'), undefined);
	});
});

suite('Health route', () => {
	async function invokeHealth(registry: Registry) {
		const handlers = createRouteHandlers(registry);
		const url = new URL('http://127.0.0.1/health');
		const handler = matchRoute(handlers, url.pathname);
		assert.ok(handler);
		const { res, result } = createCollectingResponse();
		await handler(createMockRequest(url.pathname), res, url);
		return result();
	}

	test('responds 200 without audioId and without ffmpeg', async () => {
		const response = await invokeHealth(new Registry());
		assert.strictEqual(response.statusCode, 200);
		assert.strictEqual(response.headers['content-type'], 'application/json');

		const body = JSON.parse(response.body.toString('utf8'));
		assert.strictEqual(body.ok, true);
		assert.strictEqual(body.registeredAudioCount, 0);
		assert.ok(typeof body.encodeFormat === 'string');
	});

	test('reports the registered audio count', async () => {
		const registry = new Registry();
		registry.registerAudio('/tmp/one.mp3');
		registry.registerAudio('/tmp/two.mp3');

		const response = await invokeHealth(registry);
		const body = JSON.parse(response.body.toString('utf8'));
		assert.strictEqual(body.registeredAudioCount, 2);
	});
});
