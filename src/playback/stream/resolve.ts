import * as fs from 'fs/promises';
import { Registry } from './registry';
import { computeStreamKey } from './streamKey';

export class AudioNotFoundError extends Error {
	constructor(audioId: string) {
		super(`Unknown audioId: ${audioId}`);
		this.name = 'AudioNotFoundError';
	}
}

export class SourceNotFoundError extends Error {
	constructor(fsPath: string) {
		super(`Source file not found: ${fsPath}`);
		this.name = 'SourceNotFoundError';
	}
}

export interface StreamContext {
	fsPath: string;
	key: string;
}

export async function resolveStreamContext(
	registry: Registry,
	audioId: string,
): Promise<StreamContext> {
	const fsPath = registry.resolveAudioId(audioId);
	if (!fsPath) {
		throw new AudioNotFoundError(audioId);
	}

	try {
		await fs.access(fsPath);
	} catch {
		throw new SourceNotFoundError(fsPath);
	}

	const key = await computeStreamKey(fsPath);
	return { fsPath, key };
}
