import { execFile, spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import { promisify } from 'util';
import { inferFrameAlignedChunks, ChunkEntry } from '../../src/playback/stream/chunkPlanner';
import { AudioPacket, scanAudioFrames } from '../../src/playback/stream/probe';

const execFileAsync = promisify(execFile);

const REPO_ROOT = path.resolve(__dirname, '../..');
const DEFAULT_INPUT = path.join(REPO_ROOT, 'test_audio_files', 'sine_30s.flac');
const OUT_ROOT = path.join(__dirname, 'out');

const TARGET_CHUNK_DURATION_SEC = 1;
const OVERLAP_SEC = 0.05;
const OGG_QUALITY = 6;

type ConcatStrategy = 'hard' | 'linear' | 'zerocross';

interface DecodedChunk {
	channels: Float32Array[];
	frameCount: number;
}

interface ConcatResult {
	channels: Float32Array[];
	frameCount: number;
	seamIndices: number[];
	zeroCrossingCount?: number;
	fallbackCount?: number;
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
	zeroCrossingCount?: number;
	fallbackCount?: number;
	outputOgg: string;
	outputWav: string;
}

interface SplicePoint {
	k: number;
	usedZeroCrossing: boolean;
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

function chunkTimingFromManifest(chunk: ChunkEntry): {
	startSec: number;
	endSec: number;
	durationSec: number;
} {
	return {
		startSec: chunk.startSec,
		endSec: chunk.endSec,
		durationSec: Math.max(0, chunk.endSec - chunk.startSec),
	};
}

function encodeEndSec(
	chunk: ChunkEntry,
	chunkCount: number,
	sourceDurationSec: number,
): number {
	const isFinal = chunk.index >= chunkCount - 1;
	return isFinal ? chunk.endSec : Math.min(chunk.endSec + OVERLAP_SEC, sourceDurationSec);
}

function lastPacketIndexThrough(
	packets: AudioPacket[],
	endSec: number,
	startPacketIndex: number,
): number {
	let endIdx = startPacketIndex;
	for (let i = startPacketIndex; i < packets.length; i += 1) {
		if (packets[i].ptsTimeSec > endSec) {
			break;
		}
		endIdx = i;
	}
	return endIdx;
}

function encodeFrameCount(
	chunk: ChunkEntry,
	packets: AudioPacket[],
	encodeEndSec: number,
): number {
	const endPacketIndex = lastPacketIndexThrough(packets, encodeEndSec, chunk.startFrame);
	return endPacketIndex - chunk.startFrame + 1;
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

function appendFrames(target: Float32Array[], source: Float32Array[], start: number, count: number): void {
	for (let ch = 0; ch < target.length; ch += 1) {
		const slice = source[ch].subarray(start, start + count);
		const merged = new Float32Array(target[ch].length + count);
		merged.set(target[ch]);
		merged.set(slice, target[ch].length);
		target[ch] = merged;
	}
}

function monoDownmix(channels: Float32Array[], start: number, count: number): Float32Array {
	const mono = new Float32Array(count);
	for (let i = 0; i < count; i += 1) {
		let sum = 0;
		for (let ch = 0; ch < channels.length; ch += 1) {
			sum += channels[ch][start + i];
		}
		mono[i] = sum / channels.length;
	}
	return mono;
}

function isZeroCrossing(prev: number, current: number): boolean {
	return (prev <= 0 && current > 0) || (prev >= 0 && current < 0) || current === 0;
}

function slopesMatch(tailSlope: number, headSlope: number): boolean {
	if (Math.abs(tailSlope) < 1e-12 && Math.abs(headSlope) < 1e-12) {
		return true;
	}
	return (tailSlope >= 0 && headSlope >= 0) || (tailSlope <= 0 && headSlope <= 0);
}

function combinedMagnitude(tail: number, head: number): number {
	return Math.abs(tail) + Math.abs(head);
}

function findZeroCrossingSplice(tailMono: Float32Array, headMono: Float32Array): SplicePoint {
	const ov = Math.min(tailMono.length, headMono.length);
	if (ov <= 1) {
		return { k: 0, usedZeroCrossing: false };
	}

	let bestZeroCross: { k: number; score: number } | null = null;
	let bestFallback = { k: 0, score: Infinity };

	for (let k = 1; k < ov; k += 1) {
		const tailPrev = tailMono[k - 1];
		const tailCurrent = tailMono[k];
		const headPrev = headMono[k - 1];
		const headCurrent = headMono[k];
		const score = combinedMagnitude(tailCurrent, headCurrent);

		if (score < bestFallback.score) {
			bestFallback = { k, score };
		}

		if (!isZeroCrossing(tailPrev, tailCurrent)) {
			continue;
		}

		const tailSlope = tailCurrent - tailPrev;
		const headSlope = headCurrent - headPrev;
		if (!slopesMatch(tailSlope, headSlope)) {
			continue;
		}

		if (!bestZeroCross || score < bestZeroCross.score) {
			bestZeroCross = { k, score };
		}
	}

	if (bestZeroCross) {
		return { k: bestZeroCross.k, usedZeroCrossing: true };
	}

	return { k: bestFallback.k, usedZeroCrossing: false };
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

function concatWithLinearCrossfade(chunks: DecodedChunk[], overlapFrames: number): ConcatResult {
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
				const blended = linearCrossfade(
					crossfadeTail,
					chunk.channels,
					0,
					blendFrames,
					fadeIn,
					fadeOut,
				);
				appendFrames(out, blended, 0, blendFrames);
				start = blendFrames;
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

function concatWithZeroCrossing(chunks: DecodedChunk[], overlapFrames: number): ConcatResult {
	const channelCount = chunks[0].channels.length;
	const out: Float32Array[] = Array.from({ length: channelCount }, () => new Float32Array(0));
	const seamIndices: number[] = [];
	let zeroCrossingCount = 0;
	let fallbackCount = 0;

	const spliceKs: number[] = [];
	for (let index = 0; index < chunks.length - 1; index += 1) {
		const current = chunks[index];
		const next = chunks[index + 1];
		const holdFrames = Math.min(
			overlapFrames,
			current.frameCount,
			next.frameCount,
		);
		const tailStart = current.frameCount - holdFrames;
		const tailMono = monoDownmix(current.channels, tailStart, holdFrames);
		const headMono = monoDownmix(next.channels, 0, holdFrames);
		const splice = findZeroCrossingSplice(tailMono, headMono);
		spliceKs.push(splice.k);
		if (splice.usedZeroCrossing) {
			zeroCrossingCount += 1;
		} else {
			fallbackCount += 1;
		}
	}

	for (let index = 0; index < chunks.length; index += 1) {
		const chunk = chunks[index];
		const isFinal = index >= chunks.length - 1;
		const start = index === 0 ? 0 : spliceKs[index - 1];

		if (isFinal) {
			const bodyFrames = chunk.frameCount - start;
			if (bodyFrames > 0) {
				if (index > 0) {
					seamIndices.push(out[0].length);
				}
				appendFrames(out, chunk.channels, start, bodyFrames);
			}
			continue;
		}

		const holdFrames = Math.min(overlapFrames, chunk.frameCount - start);
		const tailStart = chunk.frameCount - holdFrames;
		const k = spliceKs[index];
		const bodyEnd = tailStart + k;
		const bodyFrames = bodyEnd - start;

		if (bodyFrames > 0) {
			if (index > 0) {
				seamIndices.push(out[0].length);
			}
			appendFrames(out, chunk.channels, start, bodyFrames);
		}
	}

	return {
		channels: out,
		frameCount: out[0]?.length ?? 0,
		seamIndices,
		zeroCrossingCount,
		fallbackCount,
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
		const { startSec } = chunkTimingFromManifest(chunk);
		const encodeEnd = encodeEndSec(chunk, chunks.length, sourceDurationSec);
		const outPath = path.join(chunksDir, `chunk_${chunk.index}.ogg`);
		await transcodeChunk(ffmpegPath, inputPath, outPath, startSec, encodeEnd);
		paths.push(outPath);
	}

	return paths;
}

function printChunkPlan(chunks: ChunkEntry[], packets: AudioPacket[], sourceDurationSec: number): void {
	console.log('Chunk plan (frame-aligned, target ~1s):');
	console.log('  idx   startSec   endSec   duration   frames   encodeFrames');
	for (const chunk of chunks) {
		const { startSec, endSec, durationSec } = chunkTimingFromManifest(chunk);
		const bodyFrames = chunk.endFrame - chunk.startFrame + 1;
		const encodeEnd = encodeEndSec(chunk, chunks.length, sourceDurationSec);
		const encodeFrames = encodeFrameCount(chunk, packets, encodeEnd);
		console.log(
			`  ${String(chunk.index).padStart(3)}`
				+ `  ${startSec.toFixed(3).padStart(9)}`
				+ `  ${endSec.toFixed(3).padStart(8)}`
				+ `  ${durationSec.toFixed(3).padStart(9)}`
				+ `  ${String(bodyFrames).padStart(7)}`
				+ `  ${String(encodeFrames).padStart(13)}`,
		);
	}
	console.log('');
}

async function writeChunkPlan(
	outDir: string,
	chunks: ChunkEntry[],
	packets: AudioPacket[],
	sourceDurationSec: number,
): Promise<void> {
	const plan = chunks.map((chunk) => {
		const { startSec, endSec, durationSec } = chunkTimingFromManifest(chunk);
		const encodeEnd = encodeEndSec(chunk, chunks.length, sourceDurationSec);
		return {
			...chunk,
			durationSec,
			bodyFrameCount: chunk.endFrame - chunk.startFrame + 1,
			encodeEndSec: encodeEnd,
			encodeFrameCount: encodeFrameCount(chunk, packets, encodeEnd),
		};
	});
	await fs.writeFile(path.join(outDir, 'chunk_plan.json'), `${JSON.stringify(plan, null, 2)}\n`);
}

async function runStrategy(
	ffmpegPath: string,
	strategy: ConcatStrategy,
	label: string,
	chunks: DecodedChunk[],
	overlapFrames: number,
	outDir: string,
	channels: number,
	sampleRate: number,
): Promise<StrategyReport> {
	let result: ConcatResult;
	if (strategy === 'hard') {
		result = concatHard(chunks, overlapFrames);
	} else if (strategy === 'linear') {
		result = concatWithLinearCrossfade(chunks, overlapFrames);
	} else {
		result = concatWithZeroCrossing(chunks, overlapFrames);
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
		zeroCrossingCount: result.zeroCrossingCount,
		fallbackCount: result.fallbackCount,
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
	if (report.strategy === 'zerocross') {
		console.log(
			`    splice picks: zero-crossing=${report.zeroCrossingCount ?? 0} fallback=${report.fallbackCount ?? 0}`,
		);
	}
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
	console.log(`Target chunk duration: ~${TARGET_CHUNK_DURATION_SEC}s (frame-aligned via ffprobe packet scan)`);
	console.log(`Overlap tail: ${OVERLAP_SEC * 1000}ms`);
	console.log('');

	const frameScan = await scanAudioFrames(ffmpegPath, inputPath);
	const chunks = inferFrameAlignedChunks(
		frameScan.packets,
		TARGET_CHUNK_DURATION_SEC,
		frameScan.fileSize,
	);
	const sourceDurationSec = frameScan.probe.durationSec;
	const { channels, sampleRate } = frameScan.probe;

	if (chunks.length <= 1) {
		throw new Error(`Expected multiple chunks, got ${chunks.length}`);
	}

	console.log(`Planned ${chunks.length} chunks for ${sourceDurationSec.toFixed(3)}s source`);
	printChunkPlan(chunks, frameScan.packets, sourceDurationSec);
	await writeChunkPlan(outDir, chunks, frameScan.packets, sourceDurationSec);

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
	for (const chunkPath of chunkPaths) {
		decodedChunks.push(await decodeToPlanar(ffmpegPath, chunkPath, channels, sampleRate));
	}

	const overlapFrames = Math.max(0, Math.round(OVERLAP_SEC * sampleRate));

	const reports = await Promise.all([
		runStrategy(
			ffmpegPath,
			'hard',
			'hard cut (no crossfade)',
			decodedChunks,
			overlapFrames,
			outDir,
			channels,
			sampleRate,
		),
		runStrategy(
			ffmpegPath,
			'linear',
			'linear overlap-add (reference)',
			decodedChunks,
			overlapFrames,
			outDir,
			channels,
			sampleRate,
		),
		runStrategy(
			ffmpegPath,
			'zerocross',
			'zero-crossing splice',
			decodedChunks,
			overlapFrames,
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
	const zerocross = reports.find((report) => report.strategy === 'zerocross');

	if (!hard || !zerocross) {
		throw new Error('Missing strategy report.');
	}

	if (zerocross.seamMetrics.maxStep > hard.seamMetrics.maxStep + 1e-9) {
		console.warn(
			`WARN: zerocross max seam step ${zerocross.seamMetrics.maxStep.toFixed(6)} > hard ${hard.seamMetrics.maxStep.toFixed(6)}`,
		);
	}

	console.log('PASS: zero-crossing concat complete; listen to out/combined_*.wav for A/B.');
}

main().catch((err) => {
	console.error(err instanceof Error ? err.message : err);
	process.exit(1);
});
