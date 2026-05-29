import { execFile } from 'child_process';
import { promisify } from 'util';
import * as vscode from 'vscode';

const execFileAsync = promisify(execFile);

export interface FfmpegCheckResult {
	available: boolean;
	path: string;
	version?: string;
	error?: string;
}

let cachedResult: FfmpegCheckResult | undefined;

export async function checkFfmpegAvailable(force = false): Promise<FfmpegCheckResult> {
	if (cachedResult && !force) {
		return cachedResult;
	}

	const configuredPath = vscode.workspace
		.getConfiguration('cp-nice-player')
		.get<string>('ffmpegPath')
		?.trim();
	const candidates = configuredPath ? [configuredPath] : ['ffmpeg'];

	for (const candidate of candidates) {
		try {
			const { stdout } = await execFileAsync(candidate, ['-version'], { timeout: 5000 });
			const versionLine = stdout.split('\n').find((line) => line.trim().length > 0)?.trim();

			cachedResult = {
				available: true,
				path: candidate,
				version: versionLine,
			};
			return cachedResult;
		} catch {
			continue;
		}
	}

	cachedResult = {
		available: false,
		path: configuredPath ?? 'ffmpeg',
		error: configuredPath
			? `Could not run ffmpeg at "${configuredPath}".`
			: 'ffmpeg was not found on PATH.',
	};
	return cachedResult;
}

export function clearFfmpegCache(): void {
	cachedResult = undefined;
}
