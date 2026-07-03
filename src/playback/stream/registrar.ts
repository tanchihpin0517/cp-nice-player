import { FfmpegCheckResult } from '../../ffmpegHost';
import { Registry } from './registry';
import { getOrCreateIndex } from './indexBuilder';
import { resolveStreamContext } from './resolve';

interface RegisterResult {
	audioId: string;
}

export async function registerAudio(
	registry: Registry,
	fsPath: string,
	ffmpeg: FfmpegCheckResult,
): Promise<RegisterResult> {
	const audioId = registry.registerAudio(fsPath);
	try {
		const streamCtx = await resolveStreamContext(registry, audioId);
		await getOrCreateIndex(streamCtx, ffmpeg);
		return { audioId };
	} catch (err) {
		registry.unregisterAudio(audioId);
		throw err;
	}
}
