import { spawn } from 'child_process';
import { EncodeFormat, outputExtForEncodeFormat } from '../../encodeFormat';

function shellQuoteArg(arg: string): string {
	if (/^[A-Za-z0-9_./:=+-]+$/.test(arg)) {
		return arg;
	}
	return `'${arg.replace(/'/g, `'\\''`)}'`;
}

function formatFfmpegCommand(ffmpegPath: string, args: string[]): string {
	return [ffmpegPath, ...args.map(shellQuoteArg)].join(' ');
}

interface FfmpegRunResult {
	stdout: Buffer[];
	stderr: string;
}

function runFfmpeg(
	ffmpegPath: string,
	args: string[],
	signal?: AbortSignal,
): Promise<FfmpegRunResult> {
	return new Promise((resolve, reject) => {
		const proc = spawn(ffmpegPath, args);
		const stdout: Buffer[] = [];
		let stderr = '';

		proc.stdout.on('data', (chunk: Buffer) => {
			stdout.push(chunk);
		});

		proc.stderr.setEncoding('utf8');
		proc.stderr.on('data', (chunk: string) => {
			stderr += chunk;
		});

		const onAbort = () => {
			proc.kill('SIGTERM');
			reject(new Error('Transcode aborted'));
		};
		signal?.addEventListener('abort', onAbort, { once: true });

		proc.on('error', (err) => {
			signal?.removeEventListener('abort', onAbort);
			reject(err);
		});

		proc.on('close', (code) => {
			signal?.removeEventListener('abort', onAbort);
			if (signal?.aborted) {
				reject(new Error('Transcode aborted'));
				return;
			}
			if (code === 0) {
				resolve({ stdout, stderr });
			} else {
				const detail = stderr.trim() || `ffmpeg exited with code ${code}`;
				reject(new Error(detail));
			}
		});
	});
}

interface TranscodeChunkOptions {
	startSec: number | string;
	endSec: number | string;
	format: EncodeFormat;
	oggQuality: number;
}

function mp3Quality(oggQuality: number): number {
	return Math.min(9, Math.max(0, Math.round(oggQuality)));
}

function encodeOutputArgs(
	format: EncodeFormat,
	outputFsPath: string,
	oggQuality: number,
): string[] {
	const muxArgs =
		outputFsPath === 'pipe:1' ? ['-f', outputExtForEncodeFormat(format)] : [];

	switch (format) {
		case 'flac':
			return ['-c:a', 'flac', ...muxArgs, outputFsPath];
		case 'mp3':
			return ['-c:a', 'libmp3lame', '-q:a', String(mp3Quality(oggQuality)), ...muxArgs, outputFsPath];
		case 'wav':
			return ['-c:a', 'pcm_s16le', ...muxArgs, outputFsPath];
		default:
			return ['-c:a', 'libvorbis', '-q:a', String(oggQuality), ...muxArgs, outputFsPath];
	}
}

export function buildFfmpegChunkArgs(
	inputFsPath: string,
	outputFsPath: string,
	options: TranscodeChunkOptions,
): string[] {
	const { startSec, endSec, format, oggQuality } = options;
	const baseArgs = [
		'-y',
		'-nostats',
		'-loglevel',
		'quiet',
		'-accurate_seek',
		'-ss',
		String(startSec),
		'-to',
		String(endSec),
		'-i',
		inputFsPath,
		'-vn',
	];

	return [...baseArgs, ...encodeOutputArgs(format, outputFsPath, oggQuality)];
}

export function formatFfmpegChunkCommandTemplate(
	ffmpegPath: string,
	options: Pick<TranscodeChunkOptions, 'format' | 'oggQuality'>,
): string {
	const args = buildFfmpegChunkArgs('{input}', '{output}', {
		startSec: '{startSec}',
		endSec: '{endSec}',
		format: options.format,
		oggQuality: options.oggQuality,
	});
	return formatFfmpegCommand(ffmpegPath, args);
}

export async function transcodeChunk(
	ffmpegPath: string,
	inputFsPath: string,
	outputFsPath: string,
	options: TranscodeChunkOptions,
	signal?: AbortSignal,
): Promise<void> {
	await runFfmpeg(ffmpegPath, buildFfmpegChunkArgs(inputFsPath, outputFsPath, options), signal);
}

export async function transcodeChunkToBuffer(
	ffmpegPath: string,
	inputFsPath: string,
	options: TranscodeChunkOptions,
	signal?: AbortSignal,
): Promise<Buffer> {
	const { stdout } = await runFfmpeg(
		ffmpegPath,
		buildFfmpegChunkArgs(inputFsPath, 'pipe:1', options),
		signal,
	);
	return Buffer.concat(stdout);
}
