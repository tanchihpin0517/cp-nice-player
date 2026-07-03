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
});
