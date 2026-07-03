import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
	AudioNotFoundError,
	resolveStreamContext,
	SourceNotFoundError,
} from '../playback/stream/resolve';
import { Registry } from '../playback/stream/registry';
import { computeStreamCacheHash } from '../playback/stream/streamKey';
import {
	getChunkDurationSec,
	getCrossfadeMs,
	getPlaybackOggQuality,
} from '../config';
import { getEffectiveEncodeFormat } from '../ffmpegHost';
import {
	createTempWorkDir,
	removeTempWorkDir,
} from './helpers/ffmpegTestHelpers';

suite('Resolve stream context', () => {
	let workDir: string;
	let filePath: string;

	suiteSetup(async () => {
		workDir = await createTempWorkDir('cp-nice-player-resolve-');
		filePath = path.join(workDir, 'audio.wav');
		await fs.writeFile(filePath, 'test-audio');
	});

	suiteTeardown(async () => {
		await removeTempWorkDir(workDir);
	});

	test('resolveStreamContext returns fsPath and stable key', async () => {
		const registry = new Registry();
		const audioId = registry.registerAudio(filePath);

		const ctx = await resolveStreamContext(registry, audioId);
		const stat = await fs.stat(filePath);
		const expectedKey = computeStreamCacheHash(
			filePath,
			stat.mtimeMs,
			stat.size,
			getEffectiveEncodeFormat(),
			getPlaybackOggQuality(),
			getChunkDurationSec(),
			getCrossfadeMs(),
		);

		assert.strictEqual(ctx.fsPath, filePath);
		assert.strictEqual(ctx.key, expectedKey);
	});

	test('resolveStreamContext throws AudioNotFoundError for unknown id', async () => {
		const registry = new Registry();

		await assert.rejects(
			() => resolveStreamContext(registry, 'deadbeef'),
			(err: unknown) => err instanceof AudioNotFoundError,
		);
	});

	test('resolveStreamContext throws SourceNotFoundError when file missing', async () => {
		const registry = new Registry();
		const missingPath = path.join(workDir, 'missing.wav');
		const audioId = registry.registerAudio(missingPath);

		await assert.rejects(
			() => resolveStreamContext(registry, audioId),
			(err: unknown) => err instanceof SourceNotFoundError,
		);
	});
});
