import { execFile, spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import { promisify } from 'util';
import { inferFrameAlignedChunks, ChunkEntry } from '../../src/playback/stream/chunkPlanner';
import { ffprobePathFromFfmpeg, scanAudioFrames } from '../../src/playback/stream/probe';

const execFileAsync = promisify(execFile);

type PlaybackFormat = 'ogg' | 'flac';

const CHUNK_DURATION_SEC = 1;
const OGG_QUALITY = 6;
const DURATION_TOLERANCE_SEC = 0.1;

const REPO_ROOT = path.resolve(__dirname, '../..');
const INPUT_PATH = path.join(REPO_ROOT, 'test_audio_files', 'impurities.webm');
const OUT_ROOT = path.join(__dirname, 'out');

async function resolveFfmpeg(): Promise<string> {
	try {
		await execFileAsync('ffmpeg', ['-version'], { timeout: 5000 });
		return 'ffmpeg';
	} catch {
		throw new Error('ffmpeg was not found on PATH.');
	}
}

async function runFfmpeg(ffmpegPath: string, args: string[]): Promise<void> {
	return new Promise((resolve, reject) => {
		const proc = spawn(ffmpegPath, args);
		let stderr = '';

		proc.stderr.setEncoding('utf8');
		proc.stderr.on('data', (chunk: string) => {
			stderr += chunk;
		});

		proc.on('error', reject);
		proc.on('close', (code) => {
			if (code === 0) {
				resolve();
			} else {
				const detail = stderr.trim() || `ffmpeg exited with code ${code}`;
				reject(new Error(detail));
			}
		});
	});
}

async function transcodeChunk(
	ffmpegPath: string,
	inputFsPath: string,
	outputFsPath: string,
	startSec: number,
	endSec: number,
	format: PlaybackFormat,
): Promise<void> {
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
	const args =
		format === 'flac'
			? [...baseArgs, '-c:a', 'flac', outputFsPath]
			: [...baseArgs, '-c:a', 'libvorbis', '-q:a', String(OGG_QUALITY), outputFsPath];
	await runFfmpeg(ffmpegPath, args);
}

async function probeDuration(ffprobePath: string, filePath: string): Promise<number> {
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

async function decodeToF32le(
	ffmpegPath: string,
	input: string,
	output: string,
	channels: number,
	sampleRate: number,
): Promise<void> {
	await runFfmpeg(ffmpegPath, [
		'-y',
		'-nostats',
		'-loglevel',
		'quiet',
		'-i',
		input,
		'-ac',
		String(channels),
		'-ar',
		String(sampleRate),
		'-f',
		'f32le',
		output,
	]);
}

function maxAbsPcmDiff(a: Buffer, b: Buffer): number {
	const bytes = Math.min(a.length, b.length);
	const samples = bytes / 4;
	let max = 0;
	for (let i = 0; i < samples; i += 1) {
		const diff = Math.abs(a.readFloatLE(i * 4) - b.readFloatLE(i * 4));
		if (diff > max) {
			max = diff;
		}
	}
	return max;
}

const FLAC_PCM_MAX_ABS_DIFF = 0.1;
const FLAC_PCM_MAX_ALIGN_SAMPLES = 3000;
const FLAC_PCM_ALIGN_COARSE_STEP = 50;

function maxAbsPcmDiffWithAlign(
	a: Buffer,
	b: Buffer,
	channels: number,
	maxOffsetSamples: number,
): number {
	const bytesPerFrame = 4 * channels;
	let bestOffset = 0;
	let best = Infinity;

	for (let offset = -maxOffsetSamples; offset <= maxOffsetSamples; offset += FLAC_PCM_ALIGN_COARSE_STEP) {
		const byteOff = offset * bytesPerFrame;
		const aStart = Math.max(0, byteOff);
		const bStart = Math.max(0, -byteOff);
		const compareLen = Math.min(a.length - aStart, b.length - bStart);
		if (compareLen <= bytesPerFrame) {
			continue;
		}
		const diff = maxAbsPcmDiff(
			a.subarray(aStart, aStart + compareLen),
			b.subarray(bStart, bStart + compareLen),
		);
		if (diff < best) {
			best = diff;
			bestOffset = offset;
		}
	}

	const refineMin = Math.max(-maxOffsetSamples, bestOffset - FLAC_PCM_ALIGN_COARSE_STEP);
	const refineMax = Math.min(maxOffsetSamples, bestOffset + FLAC_PCM_ALIGN_COARSE_STEP);
	for (let offset = refineMin; offset <= refineMax; offset += 1) {
		const byteOff = offset * bytesPerFrame;
		const aStart = Math.max(0, byteOff);
		const bStart = Math.max(0, -byteOff);
		const compareLen = Math.min(a.length - aStart, b.length - bStart);
		if (compareLen <= bytesPerFrame) {
			continue;
		}
		const diff = maxAbsPcmDiff(
			a.subarray(aStart, aStart + compareLen),
			b.subarray(bStart, bStart + compareLen),
		);
		if (diff < best) {
			best = diff;
		}
	}

	return best;
}

function slicePcm(
	pcm: Buffer,
	startSec: number,
	endSec: number,
	channels: number,
	sampleRate: number,
): Buffer {
	const bytesPerFrame = 4 * channels;
	const startFrame = Math.round(startSec * sampleRate);
	const endFrame = Math.round(endSec * sampleRate);
	const startByte = startFrame * bytesPerFrame;
	const endByte = endFrame * bytesPerFrame;
	return pcm.subarray(startByte, Math.min(endByte, pcm.length));
}

function chunkExt(format: PlaybackFormat): string {
	return format === 'flac' ? 'flac' : 'ogg';
}

async function generateChunks(
	ffmpegPath: string,
	inputPath: string,
	chunks: ChunkEntry[],
	format: PlaybackFormat,
	chunksDir: string,
): Promise<string[]> {
	await fs.mkdir(chunksDir, { recursive: true });
	const ext = chunkExt(format);
	const paths: string[] = [];

	for (const chunk of chunks) {
		const outPath = path.join(chunksDir, `chunk_${chunk.index}.${ext}`);
		await transcodeChunk(ffmpegPath, inputPath, outPath, chunk.startSec, chunk.endSec, format);
		paths.push(outPath);
	}

	return paths;
}

async function combineChunksViaPcm(
	ffmpegPath: string,
	chunkPaths: string[],
	combinedPcmPath: string,
	channels: number,
	sampleRate: number,
): Promise<void> {
	const handle = await fs.open(combinedPcmPath, 'w');
	try {
		for (const chunkPath of chunkPaths) {
			const tempPcm = `${chunkPath}.pcm`;
			await decodeToF32le(ffmpegPath, chunkPath, tempPcm, channels, sampleRate);
			const pcm = await fs.readFile(tempPcm);
			await handle.write(pcm);
			await fs.unlink(tempPcm);
		}
	} finally {
		await handle.close();
	}
}

async function encodePcm(
	ffmpegPath: string,
	pcmPath: string,
	outputPath: string,
	format: PlaybackFormat,
	channels: number,
	sampleRate: number,
): Promise<void> {
	const baseArgs = [
		'-y',
		'-nostats',
		'-loglevel',
		'quiet',
		'-f',
		'f32le',
		'-ar',
		String(sampleRate),
		'-ac',
		String(channels),
		'-i',
		pcmPath,
	];
	const args =
		format === 'flac'
			? [...baseArgs, '-c:a', 'flac', outputPath]
			: [...baseArgs, '-c:a', 'libvorbis', '-q:a', String(OGG_QUALITY), outputPath];
	await runFfmpeg(ffmpegPath, args);
}

async function concatChunks(
	ffmpegPath: string,
	chunkPaths: string[],
	format: PlaybackFormat,
	outDir: string,
	channels: number,
	sampleRate: number,
): Promise<{ combinedPath: string; combinedPcmPath: string }> {
	const combinedPcmPath = path.join(outDir, 'combined.pcm');
	const combinedPath = path.join(outDir, `combined.${chunkExt(format)}`);

	await combineChunksViaPcm(ffmpegPath, chunkPaths, combinedPcmPath, channels, sampleRate);
	await encodePcm(ffmpegPath, combinedPcmPath, combinedPath, format, channels, sampleRate);

	return { combinedPath, combinedPcmPath };
}

async function verifyFlacRoundtrip(
	ffmpegPath: string,
	inputPath: string,
	chunkPaths: string[],
	chunks: ChunkEntry[],
	outDir: string,
	channels: number,
	sampleRate: number,
): Promise<void> {
	const sourcePcmPath = path.join(outDir, 'source.pcm');
	await decodeToF32le(ffmpegPath, inputPath, sourcePcmPath, channels, sampleRate);
	const sourcePcm = await fs.readFile(sourcePcmPath);

	const chunk0PcmPath = `${chunkPaths[0]}.verify.pcm`;
	await decodeToF32le(ffmpegPath, chunkPaths[0], chunk0PcmPath, channels, sampleRate);
	const chunk0Pcm = await fs.readFile(chunk0PcmPath);
	await fs.unlink(chunk0PcmPath);

	const sourceSlice = slicePcm(sourcePcm, chunks[0].startSec, chunks[0].endSec, channels, sampleRate);
	const chunk0Diff = maxAbsPcmDiff(chunk0Pcm, sourceSlice);
	if (chunk0Diff >= FLAC_PCM_MAX_ABS_DIFF) {
		throw new Error(`FLAC chunk 0 PCM max abs diff ${chunk0Diff} >= ${FLAC_PCM_MAX_ABS_DIFF}`);
	}

	const mid = chunks[Math.floor(chunks.length / 2)];
	const midPath = chunkPaths[mid.index];
	const midPcmPath = `${midPath}.verify.pcm`;
	await decodeToF32le(ffmpegPath, midPath, midPcmPath, channels, sampleRate);
	const midPcm = await fs.readFile(midPcmPath);
	await fs.unlink(midPcmPath);

	const midSlice = slicePcm(sourcePcm, mid.startSec, mid.endSec, channels, sampleRate);
	const midDiff = maxAbsPcmDiffWithAlign(midPcm, midSlice, channels, FLAC_PCM_MAX_ALIGN_SAMPLES);
	if (midDiff >= FLAC_PCM_MAX_ABS_DIFF) {
		throw new Error(`FLAC chunk ${mid.index} PCM max abs diff ${midDiff} >= ${FLAC_PCM_MAX_ABS_DIFF}`);
	}
}

async function runFormatTest(
	ffmpegPath: string,
	ffprobePath: string,
	inputPath: string,
	format: PlaybackFormat,
	chunks: ChunkEntry[],
	sourceDurationSec: number,
	channels: number,
	sampleRate: number,
): Promise<void> {
	const outDir = path.join(OUT_ROOT, format);
	const chunksDir = path.join(outDir, 'chunks');
	await fs.rm(outDir, { recursive: true, force: true });

	const chunkPaths = await generateChunks(ffmpegPath, inputPath, chunks, format, chunksDir);
	const { combinedPath } = await concatChunks(
		ffmpegPath,
		chunkPaths,
		format,
		outDir,
		channels,
		sampleRate,
	);
	const combinedDurationSec = await probeDuration(ffprobePath, combinedPath);

	const durationDiff = Math.abs(combinedDurationSec - sourceDurationSec);
	if (durationDiff > DURATION_TOLERANCE_SEC) {
		throw new Error(
			`duration mismatch: source=${sourceDurationSec.toFixed(3)}s combined=${combinedDurationSec.toFixed(3)}s diff=${durationDiff.toFixed(3)}s`,
		);
	}

	if (format === 'flac') {
		await verifyFlacRoundtrip(
			ffmpegPath,
			inputPath,
			chunkPaths,
			chunks,
			outDir,
			channels,
			sampleRate,
		);
	}
}

async function main(): Promise<void> {
	try {
		await fs.access(INPUT_PATH);
	} catch {
		console.error(`Input not found: ${INPUT_PATH}`);
		process.exit(1);
	}

	const ffmpegPath = await resolveFfmpeg();
	const ffprobePath = ffprobePathFromFfmpeg(ffmpegPath);

	console.log(`Input: ${INPUT_PATH}`);
	console.log(`Chunk duration: ${CHUNK_DURATION_SEC}s`);

	const frameScan = await scanAudioFrames(ffmpegPath, INPUT_PATH);
	const chunks = inferFrameAlignedChunks(frameScan.packets, CHUNK_DURATION_SEC, frameScan.fileSize);
	const sourceDurationSec = frameScan.probe.durationSec;
	const { channels, sampleRate } = frameScan.probe;

	if (chunks.length <= 1) {
		throw new Error(`Expected multiple chunks, got ${chunks.length}`);
	}

	const lastChunk = chunks[chunks.length - 1];
	if (Math.abs(lastChunk.endSec - sourceDurationSec) > DURATION_TOLERANCE_SEC) {
		throw new Error(
			`Last chunk endSec ${lastChunk.endSec} does not match source duration ${sourceDurationSec}`,
		);
	}

	console.log(`Planned ${chunks.length} chunks for ${sourceDurationSec.toFixed(3)}s source`);

	const formats: PlaybackFormat[] = ['ogg', 'flac'];
	let failed = false;

	for (const format of formats) {
		try {
			await runFormatTest(
				ffmpegPath,
				ffprobePath,
				INPUT_PATH,
				format,
				chunks,
				sourceDurationSec,
				channels,
				sampleRate,
			);
			console.log(`PASS ${format}`);
		} catch (err) {
			failed = true;
			const message = err instanceof Error ? err.message : String(err);
			console.error(`FAIL ${format}: ${message}`);
		}
	}

	if (failed) {
		process.exit(1);
	}
}

main().catch((err) => {
	console.error(err instanceof Error ? err.message : err);
	process.exit(1);
});
