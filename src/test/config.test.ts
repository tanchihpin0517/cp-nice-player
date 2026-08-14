import * as assert from 'assert';
import * as vscode from 'vscode';
import {
	getCachedChunksSec,
	getCachedIndexes,
	getChunkDurationSec,
	getCrossfadeMs,
	getDebugLogging,
	getMaxCachedChunks,
	getPlaybackFormat,
	getPlaybackOggQuality,
	getPrefetchChunks,
	getPrefetchSec,
	logPlaybackSettings,
} from '../config';

const CONFIG_SECTION = 'cp-nice-player';
const TARGET = vscode.ConfigurationTarget.Global;

async function setConfig(key: string, value: unknown): Promise<void> {
	await vscode.workspace.getConfiguration(CONFIG_SECTION).update(key, value, TARGET);
}

async function clearConfig(key: string): Promise<void> {
	await vscode.workspace.getConfiguration(CONFIG_SECTION).update(key, undefined, TARGET);
}

suite('Config', () => {
	suiteTeardown(async () => {
		await clearConfig('playback.oggQuality');
		await clearConfig('playback.chunkDurationSec');
		await clearConfig('playback.crossfadeMs');
		await clearConfig('playback.prefetchSec');
		await clearConfig('playback.cachedIndexes');
		await clearConfig('playback.cachedChunksSec');
		await clearConfig('playback.format');
		await clearConfig('playback.debugLogging');
	});

	test('getPlaybackOggQuality clamps to 0-10', async () => {
		await setConfig('playback.oggQuality', 99);
		assert.strictEqual(getPlaybackOggQuality(), 10);

		await setConfig('playback.oggQuality', -1);
		assert.strictEqual(getPlaybackOggQuality(), 0);
	});

	test('getChunkDurationSec clamps to 0.5-10', async () => {
		await setConfig('playback.chunkDurationSec', 20);
		assert.strictEqual(getChunkDurationSec(), 10);

		await setConfig('playback.chunkDurationSec', 0.1);
		assert.strictEqual(getChunkDurationSec(), 0.5);
	});

	test('getCrossfadeMs clamps to 0-500', async () => {
		await setConfig('playback.crossfadeMs', 999);
		assert.strictEqual(getCrossfadeMs(), 500);
	});

	test('getPrefetchSec clamps negatives to 0', async () => {
		await setConfig('playback.prefetchSec', 45);
		assert.strictEqual(getPrefetchSec(), 45);

		await setConfig('playback.prefetchSec', -10);
		assert.strictEqual(getPrefetchSec(), 0);
	});

	test('getPrefetchChunks derives the count from the chunk duration', async () => {
		await setConfig('playback.chunkDurationSec', 2);
		await setConfig('playback.prefetchSec', 30);
		assert.strictEqual(getPrefetchChunks(), 15);

		await setConfig('playback.chunkDurationSec', 4);
		assert.strictEqual(getPrefetchChunks(), 8);

		await setConfig('playback.prefetchSec', 0);
		assert.strictEqual(getPrefetchChunks(), 1);
	});

	test('getCachedIndexes clamps to a minimum of 1 with no upper bound', async () => {
		await setConfig('playback.cachedIndexes', 0);
		assert.strictEqual(getCachedIndexes(), 1);

		await setConfig('playback.cachedIndexes', 999);
		assert.strictEqual(getCachedIndexes(), 999);
	});

	test('getCachedChunksSec clamps negatives to 0', async () => {
		await setConfig('playback.cachedChunksSec', 600);
		assert.strictEqual(getCachedChunksSec(), 600);

		await setConfig('playback.cachedChunksSec', -1);
		assert.strictEqual(getCachedChunksSec(), 0);
	});

	test('getMaxCachedChunks derives the count from the chunk duration', async () => {
		await setConfig('playback.chunkDurationSec', 2);
		await setConfig('playback.cachedChunksSec', 300);
		assert.strictEqual(getMaxCachedChunks(), 150);

		await setConfig('playback.chunkDurationSec', 4);
		assert.strictEqual(getMaxCachedChunks(), 75);

		await setConfig('playback.cachedChunksSec', 0);
		assert.strictEqual(getMaxCachedChunks(), 1);
	});

	test('getPlaybackFormat falls back to ogg for invalid values', async () => {
		await setConfig('playback.format', 'invalid');
		assert.strictEqual(getPlaybackFormat(), 'ogg');

		await setConfig('playback.format', 'flac');
		assert.strictEqual(getPlaybackFormat(), 'flac');
	});

	test('getDebugLogging defaults to false', async () => {
		await clearConfig('playback.debugLogging');
		assert.strictEqual(getDebugLogging(), false);
	});

	test('logPlaybackSettings runs when debug logging enabled', async () => {
		await setConfig('playback.debugLogging', true);
		assert.strictEqual(getDebugLogging(), true);
		assert.doesNotThrow(() => logPlaybackSettings());
		await clearConfig('playback.debugLogging');
	});
});
