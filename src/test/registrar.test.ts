import * as assert from 'assert';
import * as path from 'path';
import { clearStreamIndexCache } from '../playback/stream/indexBuilder';
import { registerAudio } from '../playback/stream/registrar';
import { Registry } from '../playback/stream/registry';
import {
	createTempWorkDir,
	generateTestInputWav,
	removeTempWorkDir,
	requireFfmpeg,
} from './helpers/ffmpegTestHelpers';

suite('Registrar', () => {
	let ffmpegPath: string;
	let workDir: string;
	let inputPath: string;

	suiteSetup(async function () {
		try {
			ffmpegPath = await requireFfmpeg();
		} catch {
			this.skip();
			return;
		}

		workDir = await createTempWorkDir('cp-nice-player-registrar-');
		inputPath = path.join(workDir, 'input.wav');
		await generateTestInputWav(ffmpegPath, inputPath);
	});

	suiteTeardown(async () => {
		clearStreamIndexCache();
		await removeTempWorkDir(workDir);
	});

	setup(() => {
		clearStreamIndexCache();
	});

	test('registerAudio returns audioId and registers file', async () => {
		const registry = new Registry();
		const ffmpeg = { available: true, path: ffmpegPath };

		const { audioId } = await registerAudio(registry, inputPath, ffmpeg);

		assert.match(audioId, /^[0-9a-f]{8}$/);
		assert.strictEqual(registry.resolveAudioId(audioId), inputPath);
	});

	test('registerAudio rolls back when index build fails', async () => {
		const registry = new Registry();
		const missingPath = path.join(workDir, 'missing.wav');
		const ffmpeg = { available: true, path: ffmpegPath };
		let failedAudioId = '';

		const originalRegister = registry.registerAudio.bind(registry);
		registry.registerAudio = (fsPath: string) => {
			failedAudioId = originalRegister(fsPath);
			return failedAudioId;
		};

		await assert.rejects(() => registerAudio(registry, missingPath, ffmpeg));
		assert.strictEqual(registry.resolveAudioId(failedAudioId), undefined);
	});
});
