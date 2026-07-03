import * as assert from 'assert';
import { Registry } from '../playback/stream/registry';

suite('Registry', () => {
	test('registerAudio returns hex id and resolveAudioId returns path', () => {
		const registry = new Registry();
		const audioId = registry.registerAudio('/tmp/test.mp3');

		assert.match(audioId, /^[0-9a-f]{8}$/);
		assert.strictEqual(registry.resolveAudioId(audioId), '/tmp/test.mp3');
	});

	test('unregisterAudio removes entry', () => {
		const registry = new Registry();
		const audioId = registry.registerAudio('/tmp/test.mp3');

		registry.unregisterAudio(audioId);
		assert.strictEqual(registry.resolveAudioId(audioId), undefined);
	});

	test('clear empties registry', () => {
		const registry = new Registry();
		const audioId = registry.registerAudio('/tmp/test.mp3');

		registry.clear();
		assert.strictEqual(registry.resolveAudioId(audioId), undefined);
	});

	test('re-registering same path gets new id', () => {
		const registry = new Registry();
		const first = registry.registerAudio('/tmp/test.mp3');
		const second = registry.registerAudio('/tmp/test.mp3');

		assert.notStrictEqual(first, second);
		assert.strictEqual(registry.resolveAudioId(first), '/tmp/test.mp3');
		assert.strictEqual(registry.resolveAudioId(second), '/tmp/test.mp3');
	});
});
