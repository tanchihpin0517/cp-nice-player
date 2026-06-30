import { spawn } from 'child_process';
import { getDebugLogging, PlaybackFormat } from '../../config';

function shellQuoteArg(arg: string): string {
	if (/^[A-Za-z0-9_./:=+-]+$/.test(arg)) {
		return arg;
	}
	return `'${arg.replace(/'/g, `'\\''`)}'`;
}

function formatFfmpegCommand(ffmpegPath: string, args: string[]): string {
	return [ffmpegPath, ...args.map(shellQuoteArg)].join(' ');
}

function runFfmpeg(
	ffmpegPath: string,
	args: string[],
	signal?: AbortSignal,
): Promise<void> {
	if (getDebugLogging()) {
		console.log(`cp-nice-player: ${formatFfmpegCommand(ffmpegPath, args)}`);
	}
	return new Promise((resolve, reject) => {
		const proc = spawn(ffmpegPath, args);
		let stderr = '';

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
				resolve();
			} else {
				const detail = stderr.trim() || `ffmpeg exited with code ${code}`;
				reject(new Error(detail));
			}
		});
	});
}

export interface TranscodeChunkOptions {
	startSec: number;
	endSec: number;
	format: PlaybackFormat;
	oggQuality: number;
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
	return format === 'flac'
		? [...baseArgs, '-c:a', 'flac', outputFsPath]
		: [...baseArgs, '-c:a', 'libvorbis', '-q:a', String(oggQuality), outputFsPath];
}

export async function transcodeChunk(
	ffmpegPath: string,
	inputFsPath: string,
	outputFsPath: string,
	options: TranscodeChunkOptions,
	signal?: AbortSignal,
): Promise<void> {
	return runFfmpeg(ffmpegPath, buildFfmpegChunkArgs(inputFsPath, outputFsPath, options), signal);
}
