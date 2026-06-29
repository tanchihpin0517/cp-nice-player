import { execFile, spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import { promisify } from 'util';
import { inferFrameAlignedChunks, ChunkEntry } from '../../src/playback/stream/chunkPlanner';
import { ffprobePathFromFfmpeg, scanAudioFrames } from '../../src/playback/stream/probe';

const execFileAsync = promisify(execFile);

const REPO_ROOT = path.resolve(__dirname, '../..');
const DEFAULT_INPUT = path.join(REPO_ROOT, 'test_audio_files', 'sine_30s.flac');
const OUT_ROOT = path.join(__dirname, 'out');

const CHUNK_DURATION_SEC = 1;
const OVERLAP_SEC = 0.05;
const OGG_QUALITY = 6;
const WSOLA_SEARCH_SEC = 0.05;

type ConcatStrategy = 'hard' | 'plain' | 'wsola';

interface DecodedChunk {
	channels: Float32Array[];
	frameCount: number;
}

interface ConcatResult {
	channels: Float32Array[];
	frameCount: number;
	seamIndices: number[];
}

interface SeamMetrics {
	maxStep: number;
	meanStep: number;
	seamSteps: number[];
}

interface StrategyReport {
	strategy: ConcatStrategy;
	label: string;
	durationSec: number;
	seamMetrics: SeamMetrics;
	outputOgg: string;
	outputWav: string;
}

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
): Promise<void> {
	await runFfmpeg(ffmpegPath, [
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
		'-c:a',
		'libvorbis',
		'-q:a',
		String(OGG_QUALITY),
		outputFsPath,
	]);
}

async function decodeToPlanar(
	ffmpegPath: string,
	inputPath: string,
	channels: number,
	sampleRate: number,
): Promise<DecodedChunk> {
	const tempPcm = `${inputPath}.pcm`;
	await runFfmpeg(ffmpegPath, [
		'-y',
		'-nostats',
		'-loglevel',
		'quiet',
		'-i',
		inputPath,
		'-ac',
		String(channels),
		'-ar',
		String(sampleRate),
		'-f',
		'f32le',
		tempPcm,
	]);

	const interleaved = await fs.readFile(tempPcm);
	await fs.unlink(tempPcm);

	const frameCount = interleaved.length / (4 * channels);
	const planar: Float32Array[] = [];
	for (let ch = 0; ch < channels; ch += 1) {
		planar.push(new Float32Array(frameCount));
	}

	for (let frame = 0; frame < frameCount; frame += 1) {
		const base = frame * channels * 4;
		for (let ch = 0; ch < channels; ch += 1) {
			planar[ch][frame] = interleaved.readFloatLE(base + ch * 4);
		}
	}

	return { channels: planar, frameCount };
}

function isFrameNearZero(channels: Float32Array[], frame: number, threshold = 1e-7): boolean {
	for (let ch = 0; ch < channels.length; ch += 1) {
		if (Math.abs(channels[ch][frame]) > threshold) {
			return false;
		}
	}
	return true;
}

function expectedEncodeFrames(
	chunk: ChunkEntry,
	chunkCount: number,
	sourceDurationSec: number,
	sampleRate: number,
): number {
	const isFinal = chunk.index >= chunkCount - 1;
	const encodeEndSec = isFinal
		? chunk.endSec
		: Math.min(chunk.endSec + OVERLAP_SEC, sourceDurationSec);
	return Math.max(0, Math.round((encodeEndSec - chunk.startSec) * sampleRate));
}

function trimChunkZeroPadding(
	decoded: DecodedChunk,
	expectedFrames: number,
): { decoded: DecodedChunk; zeroTrimmed: number; overrunTrimmed: number } {
	let { channels, frameCount } = decoded;
	const originalFrames = frameCount;

	let start = 0;
	while (start < frameCount && isFrameNearZero(channels, start)) {
		start += 1;
	}

	let end = frameCount;
	while (end > start && isFrameNearZero(channels, end - 1)) {
		end -= 1;
	}

	if (start > 0 || end < frameCount) {
		channels = channels.map((ch) => ch.slice(start, end));
		frameCount = end - start;
	}

	const zeroTrimmed = originalFrames - frameCount;
	let overrunTrimmed = 0;
	if (frameCount > expectedFrames) {
		overrunTrimmed = frameCount - expectedFrames;
		channels = channels.map((ch) => ch.subarray(0, expectedFrames));
		frameCount = expectedFrames;
	}

	return {
		decoded: { channels, frameCount },
		zeroTrimmed,
		overrunTrimmed,
	};
}

function buildLinearFade(overlapFrames: number): { fadeIn: Float32Array; fadeOut: Float32Array } {
	const fadeIn = new Float32Array(overlapFrames);
	const fadeOut = new Float32Array(overlapFrames);
	for (let i = 0; i < overlapFrames; i += 1) {
		const t = (i + 0.5) / overlapFrames;
		fadeIn[i] = t;
		fadeOut[i] = 1 - t;
	}
	return { fadeIn, fadeOut };
}

function appendFrames(target: Float32Array[], source: Float32Array, start: number, count: number): void {
	for (let ch = 0; ch < target.length; ch += 1) {
		const slice = source[ch].subarray(start, start + count);
		const merged = new Float32Array(target[ch].length + count);
		merged.set(target[ch]);
		merged.set(slice, target[ch].length);
		target[ch] = merged;
	}
}

function linearCrossfade(
	tail: Float32Array[],
	head: Float32Array[],
	headStart: number,
	blendFrames: number,
	fadeIn: Float32Array,
	fadeOut: Float32Array,
): Float32Array[] {
	const blended: Float32Array[] = [];
	for (let ch = 0; ch < tail.length; ch += 1) {
		const out = new Float32Array(blendFrames);
		const tailCh = tail[ch];
		const headCh = head[ch];
		for (let i = 0; i < blendFrames; i += 1) {
			out[i] = tailCh[i] * fadeOut[i] + headCh[headStart + i] * fadeIn[i];
		}
		blended.push(out);
	}
	return blended;
}

function normalizedCrossCorrelation(
	tail: Float32Array[],
	head: Float32Array[],
	headStart: number,
	blendFrames: number,
): number {
	let dot = 0;
	let tailEnergy = 0;
	let headEnergy = 0;

	for (let ch = 0; ch < tail.length; ch += 1) {
		const tailCh = tail[ch];
		const headCh = head[ch];
		for (let i = 0; i < blendFrames; i += 1) {
			const t = tailCh[i];
			const h = headCh[headStart + i];
			dot += t * h;
			tailEnergy += t * t;
			headEnergy += h * h;
		}
	}

	const denom = Math.sqrt(tailEnergy * headEnergy);
	if (denom <= 1e-12) {
		return 0;
	}
	return dot / denom;
}

function findWsolaOffset(
	tail: Float32Array[],
	head: Float32Array[],
	blendFrames: number,
	searchRadius: number,
): number {
	let bestOffset = 0;
	let bestScore = -Infinity;

	for (let offset = -searchRadius; offset <= searchRadius; offset += 1) {
		const headStart = offset;
		if (headStart < 0) {
			continue;
		}
		if (headStart + blendFrames > head[0].length) {
			continue;
		}
		const score = normalizedCrossCorrelation(tail, head, headStart, blendFrames);
		if (score > bestScore) {
			bestScore = score;
			bestOffset = offset;
		}
	}

	return bestOffset;
}

function concatHard(chunks: DecodedChunk[], overlapFrames: number): ConcatResult {
	const channelCount = chunks[0].channels.length;
	const out: Float32Array[] = Array.from({ length: channelCount }, () => new Float32Array(0));
	const seamIndices: number[] = [];

	for (let index = 0; index < chunks.length; index += 1) {
		const chunk = chunks[index];
		const isFinal = index >= chunks.length - 1;
		const bodyFrames = isFinal ? chunk.frameCount : Math.max(0, chunk.frameCount - overlapFrames);
		if (bodyFrames > 0) {
			if (index > 0) {
				seamIndices.push(out[0].length);
			}
			appendFrames(out, chunk.channels, 0, bodyFrames);
		}
	}

	return {
		channels: out,
		frameCount: out[0]?.length ?? 0,
		seamIndices,
	};
}

function concatWithLinearCrossfade(
	chunks: DecodedChunk[],
	overlapFrames: number,
	useWsola: boolean,
	searchRadius: number,
): ConcatResult {
	const channelCount = chunks[0].channels.length;
	const out: Float32Array[] = Array.from({ length: channelCount }, () => new Float32Array(0));
	const seamIndices: number[] = [];
	const { fadeIn, fadeOut } = buildLinearFade(overlapFrames);

	let crossfadeTail: Float32Array[] | null = null;

	for (let index = 0; index < chunks.length; index += 1) {
		const chunk = chunks[index];
		const isFinal = index >= chunks.length - 1;
		let start = 0;

		if (crossfadeTail && overlapFrames > 0 && start < chunk.frameCount) {
			const blendFrames = Math.min(overlapFrames, chunk.frameCount, crossfadeTail[0].length);
			if (blendFrames > 0) {
				const headStart = useWsola
					? findWsolaOffset(crossfadeTail, chunk.channels, blendFrames, searchRadius)
					: 0;
				const blended = linearCrossfade(
					crossfadeTail,
					chunk.channels,
					headStart,
					blendFrames,
					fadeIn,
					fadeOut,
				);
				appendFrames(out, blended, 0, blendFrames);
				start = headStart + blendFrames;
				crossfadeTail = null;
			}
		}

		const bodyEnd = isFinal ? chunk.frameCount : Math.max(start, chunk.frameCount - overlapFrames);
		const bodyFrames = bodyEnd - start;
		if (bodyFrames > 0) {
			const bodyStartIndex = out[0].length;
			appendFrames(out, chunk.channels, start, bodyFrames);
			if (index > 0 && bodyStartIndex > 0) {
				seamIndices.push(bodyStartIndex);
			}
		}

		if (!isFinal && overlapFrames > 0 && chunk.frameCount > start) {
			const holdFrames = Math.min(overlapFrames, chunk.frameCount - start);
			const tailStart = chunk.frameCount - holdFrames;
			crossfadeTail = chunk.channels.map((ch) => ch.slice(tailStart, tailStart + holdFrames));
		} else {
			crossfadeTail = null;
		}
	}

	return {
		channels: out,
		frameCount: out[0]?.length ?? 0,
		seamIndices,
	};
}

function measureSeamSteps(channels: Float32Array[], seamIndices: number[]): SeamMetrics {
	const seamSteps: number[] = [];

	for (const seam of seamIndices) {
		if (seam <= 0 || seam >= channels[0].length) {
			continue;
		}
		let maxStep = 0;
		for (let ch = 0; ch < channels.length; ch += 1) {
			const step = Math.abs(channels[ch][seam] - channels[ch][seam - 1]);
			if (step > maxStep) {
				maxStep = step;
			}
		}
		seamSteps.push(maxStep);
	}

	if (seamSteps.length === 0) {
		return { maxStep: 0, meanStep: 0, seamSteps };
	}

	const maxStep = Math.max(...seamSteps);
	const meanStep = seamSteps.reduce((sum, value) => sum + value, 0) / seamSteps.length;
	return { maxStep, meanStep, seamSteps };
}

async function writeInterleavedPcm(
	outputPath: string,
	channels: Float32Array[],
	frameCount: number,
): Promise<void> {
	const channelCount = channels.length;
	const buffer = Buffer.alloc(frameCount * channelCount * 4);
	for (let frame = 0; frame < frameCount; frame += 1) {
		for (let ch = 0; ch < channelCount; ch += 1) {
			buffer.writeFloatLE(channels[ch][frame], (frame * channelCount + ch) * 4);
		}
	}
	await fs.writeFile(outputPath, buffer);
}

async function encodePcmToOgg(
	ffmpegPath: string,
	pcmPath: string,
	outputPath: string,
	channels: number,
	sampleRate: number,
): Promise<void> {
	await runFfmpeg(ffmpegPath, [
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
		'-c:a',
		'libvorbis',
		'-q:a',
		String(OGG_QUALITY),
		outputPath,
	]);
}

async function encodePcmToWav(
	ffmpegPath: string,
	pcmPath: string,
	outputPath: string,
	channels: number,
	sampleRate: number,
): Promise<void> {
	await runFfmpeg(ffmpegPath, [
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
		outputPath,
	]);
}

async function generateTailExtendedChunks(
	ffmpegPath: string,
	inputPath: string,
	chunks: ChunkEntry[],
	sourceDurationSec: number,
	chunksDir: string,
): Promise<string[]> {
	await fs.mkdir(chunksDir, { recursive: true });
	const paths: string[] = [];

	for (const chunk of chunks) {
		const isFinal = chunk.index >= chunks.length - 1;
		const encodeEndSec = isFinal
			? chunk.endSec
			: Math.min(chunk.endSec + OVERLAP_SEC, sourceDurationSec);
		const outPath = path.join(chunksDir, `chunk_${chunk.index}.ogg`);
		await transcodeChunk(ffmpegPath, inputPath, outPath, chunk.startSec, encodeEndSec);
		paths.push(outPath);
	}

	return paths;
}

async function runStrategy(
	ffmpegPath: string,
	strategy: ConcatStrategy,
	label: string,
	chunks: DecodedChunk[],
	overlapFrames: number,
	searchRadius: number,
	outDir: string,
	channels: number,
	sampleRate: number,
): Promise<StrategyReport> {
	let result: ConcatResult;
	if (strategy === 'hard') {
		result = concatHard(chunks, overlapFrames);
	} else {
		result = concatWithLinearCrossfade(
			chunks,
			overlapFrames,
			strategy === 'wsola',
			searchRadius,
		);
	}

	const seamMetrics = measureSeamSteps(result.channels, result.seamIndices);
	const pcmPath = path.join(outDir, `combined_${strategy}.pcm`);
	const outputOgg = path.join(outDir, `combined_${strategy}.ogg`);
	const outputWav = path.join(outDir, `combined_${strategy}.wav`);

	await writeInterleavedPcm(pcmPath, result.channels, result.frameCount);
	await encodePcmToOgg(ffmpegPath, pcmPath, outputOgg, channels, sampleRate);
	await encodePcmToWav(ffmpegPath, pcmPath, outputWav, channels, sampleRate);

	return {
		strategy,
		label,
		durationSec: result.frameCount / sampleRate,
		seamMetrics,
		outputOgg,
		outputWav,
	};
}

function printReport(report: StrategyReport): void {
	console.log(`  ${report.label}`);
	console.log(`    duration=${report.durationSec.toFixed(3)}s seams=${report.seamMetrics.seamSteps.length}`);
	console.log(
		`    seam step max=${report.seamMetrics.maxStep.toFixed(6)} mean=${report.seamMetrics.meanStep.toFixed(6)}`,
	);
	console.log(`    ogg=${report.outputOgg}`);
	console.log(`    wav=${report.outputWav}`);
}

async function main(): Promise<void> {
	const inputPath = path.resolve(process.argv[2] ?? DEFAULT_INPUT);

	try {
		await fs.access(inputPath);
	} catch {
		console.error(`Input not found: ${inputPath}`);
		process.exit(1);
	}

	const ffmpegPath = await resolveFfmpeg();
	const outDir = OUT_ROOT;
	const chunksDir = path.join(outDir, 'chunks');
	await fs.rm(outDir, { recursive: true, force: true });
	await fs.mkdir(outDir, { recursive: true });

	console.log(`Input: ${inputPath}`);
	console.log(`Chunk duration: ${CHUNK_DURATION_SEC}s`);
	console.log(`Overlap tail: ${OVERLAP_SEC * 1000}ms (linear crossfade)`);
	console.log(`WSOLA search: ±${WSOLA_SEARCH_SEC * 1000}ms`);
	console.log('');

	const frameScan = await scanAudioFrames(ffmpegPath, inputPath);
	const chunks = inferFrameAlignedChunks(
		frameScan.packets,
		CHUNK_DURATION_SEC,
		frameScan.fileSize,
	);
	const sourceDurationSec = frameScan.probe.durationSec;
	const { channels, sampleRate } = frameScan.probe;

	if (chunks.length <= 1) {
		throw new Error(`Expected multiple chunks, got ${chunks.length}`);
	}

	console.log(`Planned ${chunks.length} chunks for ${sourceDurationSec.toFixed(3)}s source`);
	console.log('');

	const chunkPaths = await generateTailExtendedChunks(
		ffmpegPath,
		inputPath,
		chunks,
		sourceDurationSec,
		chunksDir,
	);
	console.log(`Generated ${chunkPaths.length} tail-extended Ogg chunks in ${chunksDir}`);
	console.log('');

	const decodedChunks: DecodedChunk[] = [];
	let trimmedZeroFrames = 0;
	let trimmedOverrunFrames = 0;
	for (let index = 0; index < chunkPaths.length; index += 1) {
		const raw = await decodeToPlanar(ffmpegPath, chunkPaths[index], channels, sampleRate);
		const expectedFrames = expectedEncodeFrames(
			chunks[index],
			chunks.length,
			sourceDurationSec,
			sampleRate,
		);
		const { decoded, zeroTrimmed, overrunTrimmed } = trimChunkZeroPadding(raw, expectedFrames);
		trimmedZeroFrames += zeroTrimmed;
		trimmedOverrunFrames += overrunTrimmed;
		decodedChunks.push(decoded);
	}
	if (trimmedZeroFrames > 0 || trimmedOverrunFrames > 0) {
		console.log(
			`Trimmed decode padding: zero=${trimmedZeroFrames} frames, overrun=${trimmedOverrunFrames} frames`,
		);
		console.log('');
	}

	const overlapFrames = Math.max(0, Math.round(OVERLAP_SEC * sampleRate));
	const searchRadius = Math.max(1, Math.round(WSOLA_SEARCH_SEC * sampleRate));

	const reports = await Promise.all([
		runStrategy(
			ffmpegPath,
			'hard',
			'hard cut (no crossfade)',
			decodedChunks,
			overlapFrames,
			searchRadius,
			outDir,
			channels,
			sampleRate,
		),
		runStrategy(
			ffmpegPath,
			'plain',
			'plain linear overlap-add',
			decodedChunks,
			overlapFrames,
			searchRadius,
			outDir,
			channels,
			sampleRate,
		),
		runStrategy(
			ffmpegPath,
			'wsola',
			'WSOLA-aligned linear overlap-add',
			decodedChunks,
			overlapFrames,
			searchRadius,
			outDir,
			channels,
			sampleRate,
		),
	]);

	console.log('Results:');
	for (const report of reports) {
		printReport(report);
	}
	console.log('');

	const hard = reports.find((report) => report.strategy === 'hard');
	const plain = reports.find((report) => report.strategy === 'plain');
	const wsola = reports.find((report) => report.strategy === 'wsola');

	if (!hard || !plain || !wsola) {
		throw new Error('Missing strategy report.');
	}

	let failed = false;
	if (plain.seamMetrics.maxStep > hard.seamMetrics.maxStep + 1e-9) {
		console.warn(
			`WARN: plain max seam step ${plain.seamMetrics.maxStep.toFixed(6)} > hard ${hard.seamMetrics.maxStep.toFixed(6)}`,
		);
	}
	if (wsola.seamMetrics.maxStep > plain.seamMetrics.maxStep + 1e-9) {
		console.warn(
			`WARN: wsola max seam step ${wsola.seamMetrics.maxStep.toFixed(6)} > plain ${plain.seamMetrics.maxStep.toFixed(6)}`,
		);
		failed = true;
	}

	if (failed) {
		console.error('FAIL: WSOLA did not improve on plain linear overlap-add (max seam step).');
		process.exit(1);
	}

	console.log('PASS: wsola <= plain (max seam step); listen to out/combined_*.wav for A/B.');
}

main().catch((err) => {
	console.error(err instanceof Error ? err.message : err);
	process.exit(1);
});
