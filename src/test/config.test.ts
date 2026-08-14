import * as assert from 'assert';
import * as vscode from 'vscode';
import {
	getChunkBufferCount,
	getChunkDurationSec,
	getCrossfadeMs,
	getDebugLogging,
	getMaxEncodedChunks,
	getMaxIndexEntries,
	getPlaybackFormat,
	getPlaybackOggQuality,
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
		await clearConfig('playback.chunkBufferCount');
		await clearConfig('playback.maxIndexEntries');
		await clearConfig('playback.maxEncodedChunks');
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

	test('getChunkBufferCount clamps to a minimum of 1 with no upper bound', async () => {
		await setConfig('playback.chunkBufferCount', 0);
		assert.strictEqual(getChunkBufferCount(), 1);

		await setConfig('playback.chunkBufferCount', 500);
		assert.strictEqual(getChunkBufferCount(), 500);
	});

	test('getMaxIndexEntries clamps to 1-256', async () => {
		await setConfig('playback.maxIndexEntries', 0);
		assert.strictEqual(getMaxIndexEntries(), 1);

		await setConfig('playback.maxIndexEntries', 999);
		assert.strictEqual(getMaxIndexEntries(), 256);
	});

	test('getMaxEncodedChunks clamps to a minimum of 1 with no upper bound', async () => {
		await setConfig('playback.maxEncodedChunks', 0);
		assert.strictEqual(getMaxEncodedChunks(), 1);

		await setConfig('playback.maxEncodedChunks', 999);
		assert.strictEqual(getMaxEncodedChunks(), 999);
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
