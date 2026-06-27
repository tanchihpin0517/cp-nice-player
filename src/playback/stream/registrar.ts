import * as vscode from 'vscode';
import { FfmpegCheckResult } from '../../ffmpegHost';
import { Registry } from './registry';
import { getOrCreateIndex } from './indexBuilder';
import { resolveStreamContext } from './resolve';

export interface RegisterResult {
	audioId: string;
}

export async function registerAudio(
	context: vscode.ExtensionContext,
	registry: Registry,
	fsPath: string,
	ffmpeg: FfmpegCheckResult,
): Promise<RegisterResult> {
	const audioId = registry.registerAudio(fsPath);
	try {
		const streamCtx = await resolveStreamContext(registry, context, audioId);
		await getOrCreateIndex(streamCtx, ffmpeg);
		return { audioId };
	} catch (err) {
		registry.unregisterAudio(audioId);
		throw err;
	}
}
