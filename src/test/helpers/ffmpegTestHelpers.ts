import { execFile } from 'child_process';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import { codecForEncodeFormat, EncodeFormat } from '../../encodeFormat';

const execFileAsync = promisify(execFile);

export const DURATION_TOLERANCE_SEC = 0.08;
export const INDEX_DURATION_TOLERANCE_SEC = 0.15;

export async function requireFfmpeg(): Promise<string> {
	try {
		await execFileAsync('ffmpeg', ['-version'], { timeout: 5000 });
		return 'ffmpeg';
	} catch {
		throw new Error('ffmpeg was not found on PATH.');
	}
}

export async function createTempWorkDir(prefix: string): Promise<string> {
	return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

export async function removeTempWorkDir(workDir: string | undefined): Promise<void> {
	if (workDir) {
		await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
	}
}

export async function generateTestInputWav(
	ffmpegPath: string,
	outputPath: string,
	durationSec = 3,
): Promise<void> {
	await execFileAsync(
		ffmpegPath,
		[
			'-y',
			'-nostats',
			'-loglevel',
			'quiet',
			'-f',
			'lavfi',
			'-i',
			`sine=frequency=440:duration=${durationSec}`,
			'-ac',
			'2',
			'-ar',
			'44100',
			outputPath,
		],
		{ timeout: 30000 },
	);
}

export async function probeDuration(ffprobePath: string, filePath: string): Promise<number> {
	const { stdout } = await execFileAsync(
		ffprobePath,
		['-v', 'quiet', '-show_entries', 'format=duration', '-of', 'csv=p=0', filePath],
		{ timeout: 30000 },
	);
	const duration = Number.parseFloat(stdout.trim());
	if (!Number.isFinite(duration) || duration <= 0) {
		throw new Error(`Could not read duration for ${filePath}`);
	}
	return duration;
}

export async function probeInstalledEncoders(ffmpegPath: string): Promise<Set<string>> {
	const { stdout } = await execFileAsync(ffmpegPath, ['-hide_banner', '-encoders'], {
		timeout: 10000,
	});
	const encoders = new Set<string>();
	for (const line of stdout.split('\n')) {
		const match = line.trim().match(/^[AVS][\w.]+\s+(\S+)/);
		if (match) {
			encoders.add(match[1]);
		}
	}
	return encoders;
}

export function encodeFormatAvailability(encoders: Set<string>): Record<EncodeFormat, boolean> {
	return {
		ogg: encoders.has(codecForEncodeFormat('ogg')),
		mp3: encoders.has(codecForEncodeFormat('mp3')),
		flac: encoders.has(codecForEncodeFormat('flac')),
		wav: encoders.has(codecForEncodeFormat('wav')),
	};
}

export function skipUnlessEncodeAvailable(
	context: Mocha.Context,
	encodeAvailable: Record<EncodeFormat, boolean>,
	format: EncodeFormat,
): void {
	if (!encodeAvailable[format]) {
		context.skip();
	}
}
