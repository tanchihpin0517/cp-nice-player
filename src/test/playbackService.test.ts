import * as assert from 'assert';
import { PlaybackService } from '../playback/playbackService';
import { clearStreamIndexCache } from '../playback/stream/indexBuilder';

suite('Playback service', () => {
	let service: PlaybackService;

	setup(() => {
		service = new PlaybackService();
	});

	teardown(() => {
		service.dispose();
		clearStreamIndexCache();
	});

	test('ensureStarted is idempotent', async () => {
		await service.ensureStarted();
		const first = service.getServer();
		await service.ensureStarted();
		const second = service.getServer();

		assert.strictEqual(first, second);
		assert.ok(first);
	});

	test('getServer returns server after start', async () => {
		assert.strictEqual(service.getServer(), undefined);
		await service.ensureStarted();
		assert.ok(service.getServer());
	});

	test('dispose clears server and allows restart', async () => {
		await service.ensureStarted();
		const first = service.getServer();
		service.dispose();
		assert.strictEqual(service.getServer(), undefined);

		await service.ensureStarted();
		const second = service.getServer();
		assert.notStrictEqual(first, second);
		assert.ok(second);
	});

	test('getStatus reports stopped before the server starts', async () => {
		const status = await service.getStatus();

		assert.strictEqual(status.state, 'stopped');
		assert.strictEqual(status.registeredAudioCount, 0);
		assert.strictEqual(status.urlForwarded, false);
		assert.strictEqual(status.hostReachable, undefined);
		assert.ok(status.ffmpeg);
	});

	test('getStatus reports a listening, self-reachable server', async () => {
		await service.ensureStarted();
		const status = await service.getStatus();

		assert.strictEqual(status.state, 'listening');
		assert.ok(status.port && status.port > 0);
		assert.strictEqual(status.hostReachable?.ok, true);
	});

	test('restart replaces the server with a fresh listening one', async () => {
		await service.ensureStarted();
		const before = service.getServer();

		await service.restart();
		const after = service.getServer();
		const status = await service.getStatus();

		assert.ok(after);
		assert.notStrictEqual(after, before);
		assert.strictEqual(status.state, 'listening');
		assert.strictEqual(status.hostReachable?.ok, true);
		assert.strictEqual(before?.getStatus({ available: true, path: 'ffmpeg' }).state, 'disposed');
	});

	test('restart from a stopped service starts a server', async () => {
		await service.restart();
		const status = await service.getStatus();

		assert.strictEqual(status.state, 'listening');
	});
});
