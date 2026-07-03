import * as assert from 'assert';
import * as vscode from 'vscode';
import {
	checkFfmpegAvailable,
	clearFfmpegCache,
	FFMPEG_MISSING_NOTIFIED_KEY,
	getEffectiveEncodeFormat,
	maybeNotifyFfmpegMissingOnce,
	refreshEncodeFormatResolution,
	warmFfmpegAndNotifyOnce,
} from '../ffmpegHost';
import { createMockExtensionContext } from './helpers/mockExtensionContext';
import { requireFfmpeg } from './helpers/ffmpegTestHelpers';

const CONFIG_SECTION = 'cp-nice-player';
const TARGET = vscode.ConfigurationTarget.Global;

suite('FFmpeg host', () => {
	const context = createMockExtensionContext();

	suiteSetup(async function () {
		try {
			await requireFfmpeg();
		} catch {
			this.skip();
		}
	});

	setup(async () => {
		await clearFfmpegCache(context);
		await context.globalState.update(FFMPEG_MISSING_NOTIFIED_KEY, undefined);
		await vscode.workspace.getConfiguration(CONFIG_SECTION).update('ffmpegPath', undefined, TARGET);
		await vscode.workspace.getConfiguration(CONFIG_SECTION).update('playback.format', undefined, TARGET);
	});

	suiteTeardown(async () => {
		await clearFfmpegCache(context);
		await vscode.workspace.getConfiguration(CONFIG_SECTION).update('ffmpegPath', undefined, TARGET);
		await vscode.workspace.getConfiguration(CONFIG_SECTION).update('playback.format', undefined, TARGET);
	});

	test('checkFfmpegAvailable probes encoders and encode format', async () => {
		const result = await checkFfmpegAvailable(true);

		assert.strictEqual(result.available, true);
		assert.ok(result.encoders);
		assert.ok(result.encodeFormat);
		assert.ok(result.path.length > 0);
	});

	test('getEffectiveEncodeFormat matches checkFfmpegAvailable result', async () => {
		const result = await checkFfmpegAvailable(true);
		assert.strictEqual(getEffectiveEncodeFormat(), result.encodeFormat);
	});

	test('refreshEncodeFormatResolution updates encode format after config change', async function () {
		const result = await checkFfmpegAvailable(true);
		if (!result.encoders?.flac) {
			this.skip();
		}

		await vscode.workspace
			.getConfiguration(CONFIG_SECTION)
			.update('playback.format', 'flac', TARGET);
		refreshEncodeFormatResolution();

		assert.strictEqual(getEffectiveEncodeFormat(), 'flac');
	});

	test('clearFfmpegCache re-probes after invalidation', async () => {
		const first = await checkFfmpegAvailable(true);
		const second = await clearFfmpegCache(context);

		assert.strictEqual(second.available, true);
		assert.strictEqual(second.path, first.path);
	});

	test('maybeNotifyFfmpegMissingOnce sets global state once', async () => {
		await maybeNotifyFfmpegMissingOnce(context, {
			available: false,
			path: 'ffmpeg',
			error: 'missing',
		});
		assert.strictEqual(context.globalState.get(FFMPEG_MISSING_NOTIFIED_KEY), true);

		await maybeNotifyFfmpegMissingOnce(context, {
			available: false,
			path: 'ffmpeg',
			error: 'missing',
		});
		assert.strictEqual(context.globalState.get(FFMPEG_MISSING_NOTIFIED_KEY), true);
	});

	test('warmFfmpegAndNotifyOnce returns ffmpeg result', async () => {
		const result = await warmFfmpegAndNotifyOnce(context);
		assert.strictEqual(result.available, true);
	});

	test('checkFfmpegAvailable reports configured path failure', async () => {
		await vscode.workspace
			.getConfiguration(CONFIG_SECTION)
			.update('ffmpegPath', '/nonexistent/ffmpeg', TARGET);

		const result = await clearFfmpegCache(context);
		assert.strictEqual(result.available, false);
		assert.match(result.error ?? '', /\/nonexistent\/ffmpeg/);
	});
});
