import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import { Registry } from './registry';
import { computeCacheDirName, getStreamCacheDir } from './cache';

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
	cacheDirName: string;
	cacheDirFsPath: string;
}

export async function resolveStreamContext(
	registry: Registry,
	context: vscode.ExtensionContext,
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

	const cacheDirName = await computeCacheDirName(fsPath);
	const cacheDirFsPath = path.join(getStreamCacheDir(context).fsPath, cacheDirName);
	return { fsPath, cacheDirName, cacheDirFsPath };
}
