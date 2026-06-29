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
const OVERLAP_SEC = 0;
const OGG_QUALITY = 6;
const ZERO_THRESHOLD = 1e-7;

interface ChunkPaddingReport {
	index: number;
	sourceStartSec: number;
	sourceEndSec: number;
	manifestDurationSec: number;
	encodeEndSec: number;
	encodeWindowSec: number;
	ffprobeChunkDurationSec: number;
	ffprobeChunkFrames: number;
	decodedFrames: number;
	decodedDurationSec: number;
	headZeroFrames: number;
	headZeroSec: number;
	tailZeroFrames: number;
	tailZeroSec: number;
	tailOverrunFrames: number;
	tailOverrunSec: number;
	underrunFrames: number;
	underrunSec: number;
	totalHeadPaddingSec: number;
	totalTailPaddingSec: number;
}

interface SummaryReport {
	inputPath: string;
	sourceDurationSec: number;
	sampleRate: number;
	channels: number;
	chunkCount: number;
	sumManifestDurationSec: number;
	sumFfprobeChunkDurationSec: number;
	sumBodyDurationSec: number;
	sumHeadZeroSec: number;
	sumTailZeroSec: number;
	sumTailOverrunSec: number;
	sumTotalHeadPaddingSec: number;
	sumTotalTailPaddingSec: number;
	maxHeadPaddingSec: number;
	maxTailPaddingSec: number;
	meanHeadPaddingSec: number;
	meanTailPaddingSec: number;
	longerThanSourceBySec: number;
	chunks: ChunkPaddingReport[];
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

async function probeOggChunkDuration(ffprobePath: string, filePath: string): Promise<number> {
	const { stdout } = await execFileAsync(
		ffprobePath,
		[
			'-v',
			'quiet',
			'-print_format',
			'json',
			'-show_entries',
			'format=duration:stream=duration',
			'-select_streams',
			'a:0',
			filePath,
		],
		{ timeout: 30000 },
	);

	const parsed = JSON.parse(stdout) as {
		format?: { duration?: string };
		streams?: Array<{ duration?: string }>;
	};

	const streamDuration = Number.parseFloat(parsed.streams?.[0]?.duration ?? '');
	if (Number.isFinite(streamDuration) && streamDuration > 0) {
		return streamDuration;
	}

	const formatDuration = Number.parseFloat(parsed.format?.duration ?? '');
	if (Number.isFinite(formatDuration) && formatDuration > 0) {
		return formatDuration;
	}

	throw new Error(`Could not read ffprobe duration for ${filePath}`);
}

async function probeDuration(ffprobePath: string, filePath: string): Promise<number> {
	return probeOggChunkDuration(ffprobePath, filePath);
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

function decodeAndMeasurePadding(
	ffmpegPath: string,
	inputPath: string,
	channels: number,
	sampleRate: number,
	expectedFrames: number,
): Promise<{
	decodedFrames: number;
	headZeroFrames: number;
	tailZeroFrames: number;
	tailOverrunFrames: number;
	underrunFrames: number;
}> {
	return new Promise((resolve, reject) => {
		const tempPcm = `${inputPath}.edge.pcm`;
		const proc = spawn(ffmpegPath, [
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

		proc.on('error', reject);
		proc.on('close', async (code) => {
			if (code !== 0) {
				reject(new Error(`ffmpeg decode failed for ${inputPath}`));
				return;
			}
			try {
				const buf = await fs.readFile(tempPcm);
				await fs.unlink(tempPcm);
				const decodedFrames = buf.length / (4 * channels);

				const frameNearZero = (frame: number): boolean => {
					for (let ch = 0; ch < channels; ch += 1) {
						const value = buf.readFloatLE((frame * channels + ch) * 4);
						if (Math.abs(value) > ZERO_THRESHOLD) {
							return false;
						}
					}
					return true;
				};

				let headZeroFrames = 0;
				while (headZeroFrames < decodedFrames && frameNearZero(headZeroFrames)) {
					headZeroFrames += 1;
				}

				let tailZeroFrames = 0;
				while (
					tailZeroFrames < decodedFrames - headZeroFrames
					&& frameNearZero(decodedFrames - 1 - tailZeroFrames)
				) {
					tailZeroFrames += 1;
				}

				const tailOverrunFrames = Math.max(0, decodedFrames - expectedFrames);
				const underrunFrames = Math.max(0, expectedFrames - decodedFrames);

				resolve({
					decodedFrames,
					headZeroFrames,
					tailZeroFrames,
					tailOverrunFrames,
					underrunFrames,
				});
			} catch (err) {
				reject(err);
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

function framesToSec(frames: number, sampleRate: number): number {
	return frames / sampleRate;
}

function buildChunkReport(
	chunk: ChunkEntry,
	chunks: ChunkEntry[],
	sourceDurationSec: number,
	sampleRate: number,
	ffprobeChunkDurationSec: number,
	decode: {
		decodedFrames: number;
		headZeroFrames: number;
		tailZeroFrames: number;
		tailOverrunFrames: number;
		underrunFrames: number;
	},
): ChunkPaddingReport {
	const { startSec, endSec, durationSec: manifestDurationSec } = chunkTimingFromManifest(chunk);
	const encodeEnd = encodeEndSec(chunk, chunks.length, sourceDurationSec);
	const encodeWindowSec = encodeEnd - startSec;
	const ffprobeChunkFrames = Math.round(ffprobeChunkDurationSec * sampleRate);
	const headZeroSec = framesToSec(decode.headZeroFrames, sampleRate);
	const tailZeroSec = framesToSec(decode.tailZeroFrames, sampleRate);
	const tailOverrunSec = framesToSec(decode.tailOverrunFrames, sampleRate);
	const underrunSec = framesToSec(decode.underrunFrames, sampleRate);

	return {
		index: chunk.index,
		sourceStartSec: startSec,
		sourceEndSec: endSec,
		manifestDurationSec,
		encodeEndSec: encodeEnd,
		encodeWindowSec,
		ffprobeChunkDurationSec,
		ffprobeChunkFrames,
		decodedFrames: decode.decodedFrames,
		decodedDurationSec: framesToSec(decode.decodedFrames, sampleRate),
		headZeroFrames: decode.headZeroFrames,
		headZeroSec,
		tailZeroFrames: decode.tailZeroFrames,
		tailZeroSec,
		tailOverrunFrames: decode.tailOverrunFrames,
		tailOverrunSec,
		underrunFrames: decode.underrunFrames,
		underrunSec,
		totalHeadPaddingSec: headZeroSec,
		totalTailPaddingSec: tailZeroSec + tailOverrunSec,
	};
}

async function analyzeInput(
	ffmpegPath: string,
	ffprobePath: string,
	inputPath: string,
	outDir: string,
): Promise<SummaryReport> {
	const frameScan = await scanAudioFrames(ffmpegPath, inputPath);
	const chunks = inferFrameAlignedChunks(
		frameScan.packets,
		CHUNK_DURATION_SEC,
		frameScan.fileSize,
	);
	const sourceDurationSec = frameScan.probe.durationSec;
	const { channels, sampleRate } = frameScan.probe;
	const chunksDir = path.join(outDir, 'chunks');
	await fs.mkdir(chunksDir, { recursive: true });

	const chunkReports: ChunkPaddingReport[] = [];

	for (const chunk of chunks) {
		const { startSec, durationSec: manifestDurationSec } = chunkTimingFromManifest(chunk);
		const encodeEnd = encodeEndSec(chunk, chunks.length, sourceDurationSec);
		const outPath = path.join(chunksDir, `chunk_${chunk.index}.ogg`);
		await transcodeChunk(ffmpegPath, inputPath, outPath, startSec, encodeEnd);

		const ffprobeChunkDurationSec = await probeOggChunkDuration(ffprobePath, outPath);
		const ffprobeChunkFrames = Math.round(ffprobeChunkDurationSec * sampleRate);
		const decode = await decodeAndMeasurePadding(
			ffmpegPath,
			outPath,
			channels,
			sampleRate,
			ffprobeChunkFrames,
		);

		chunkReports.push(buildChunkReport(
			chunk,
			chunks,
			sourceDurationSec,
			sampleRate,
			ffprobeChunkDurationSec,
			decode,
		));
	}

	const overlapFrames = Math.round(OVERLAP_SEC * sampleRate);
	const sumDecodedDurationSec = chunkReports.reduce(
		(sum, chunk) => sum + chunk.decodedDurationSec,
		0,
	);
	const sumManifestDurationSec = chunkReports.reduce(
		(sum, chunk) => sum + chunk.manifestDurationSec,
		0,
	);
	const sumFfprobeChunkDurationSec = chunkReports.reduce(
		(sum, chunk) => sum + chunk.ffprobeChunkDurationSec,
		0,
	);
	const sumBodyDurationSec = chunkReports.reduce((sum, chunk, index) => {
		const isFinal = index >= chunkReports.length - 1;
		const bodyFrames = isFinal
			? chunk.decodedFrames
			: Math.max(0, chunk.decodedFrames - overlapFrames);
		return sum + bodyFrames / sampleRate;
	}, 0);

	const sumHeadZeroSec = chunkReports.reduce((sum, chunk) => sum + chunk.headZeroSec, 0);
	const sumTailZeroSec = chunkReports.reduce((sum, chunk) => sum + chunk.tailZeroSec, 0);
	const sumTailOverrunSec = chunkReports.reduce((sum, chunk) => sum + chunk.tailOverrunSec, 0);
	const sumTotalHeadPaddingSec = chunkReports.reduce(
		(sum, chunk) => sum + chunk.totalHeadPaddingSec,
		0,
	);
	const sumTotalTailPaddingSec = chunkReports.reduce(
		(sum, chunk) => sum + chunk.totalTailPaddingSec,
		0,
	);

	return {
		inputPath,
		sourceDurationSec,
		sampleRate,
		channels,
		chunkCount: chunkReports.length,
		sumDecodedDurationSec,
		sumManifestDurationSec,
		sumFfprobeChunkDurationSec,
		sumBodyDurationSec,
		sumHeadZeroSec,
		sumTailZeroSec,
		sumTailOverrunSec,
		sumTotalHeadPaddingSec,
		sumTotalTailPaddingSec,
		maxHeadPaddingSec: Math.max(...chunkReports.map((chunk) => chunk.totalHeadPaddingSec)),
		maxTailPaddingSec: Math.max(...chunkReports.map((chunk) => chunk.totalTailPaddingSec)),
		meanHeadPaddingSec: sumTotalHeadPaddingSec / chunkReports.length,
		meanTailPaddingSec: sumTotalTailPaddingSec / chunkReports.length,
		longerThanSourceBySec: sumBodyDurationSec - sourceDurationSec,
		chunks: chunkReports,
	};
}

function formatMs(sec: number): string {
	return `${(sec * 1000).toFixed(2)} ms`;
}

function chunkRow(chunk: ChunkPaddingReport): string {
	return [
		String(chunk.index).padStart(4),
		chunk.manifestDurationSec.toFixed(3).padStart(8),
		chunk.ffprobeChunkDurationSec.toFixed(3).padStart(8),
		chunk.decodedDurationSec.toFixed(3).padStart(8),
		formatMs(chunk.totalHeadPaddingSec).padStart(10),
		formatMs(chunk.tailOverrunSec).padStart(12),
		formatMs(chunk.underrunSec).padStart(10),
	].join('  ');
}

function printPerChunkTable(report: SummaryReport): void {
	console.log('Per-chunk timing and padding (all chunks):');
	console.log(
		[
			' idx',
			' manifest',
			' ffprobe',
			' decoded',
			' head pad',
			' tail overrun',
			' underrun',
		].join('  '),
	);
	console.log(`  ${'-'.repeat(78)}`);
	for (const chunk of report.chunks) {
		console.log(`  ${chunkRow(chunk)}`);
	}
	console.log('');
	console.log('  manifest = source ffprobe packet plan (endSec - startSec), like cnap index');
	console.log('  ffprobe  = ffprobe stream/format duration on encoded Ogg chunk');
	console.log('  decoded  = ffmpeg PCM decode duration at source sample rate');
	console.log('');
}

async function writeReports(report: SummaryReport, outDir: string): Promise<void> {
	const jsonPath = path.join(outDir, 'padding_report.json');
	await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);

	const csvHeader = [
		'index',
		'manifest_duration_sec',
		'encode_window_sec',
		'ffprobe_chunk_duration_sec',
		'decoded_sec',
		'head_zero_frames',
		'head_zero_ms',
		'tail_zero_frames',
		'tail_zero_ms',
		'tail_overrun_frames',
		'tail_overrun_ms',
		'underrun_frames',
		'underrun_ms',
		'total_head_padding_ms',
		'total_tail_padding_ms',
	].join(',');

	const csvRows = report.chunks.map((chunk) => [
		chunk.index,
		chunk.manifestDurationSec.toFixed(6),
		chunk.encodeWindowSec.toFixed(6),
		chunk.ffprobeChunkDurationSec.toFixed(6),
		chunk.decodedDurationSec.toFixed(6),
		chunk.headZeroFrames,
		(chunk.headZeroSec * 1000).toFixed(3),
		chunk.tailZeroFrames,
		(chunk.tailZeroSec * 1000).toFixed(3),
		chunk.tailOverrunFrames,
		(chunk.tailOverrunSec * 1000).toFixed(3),
		chunk.underrunFrames,
		(chunk.underrunSec * 1000).toFixed(3),
		(chunk.totalHeadPaddingSec * 1000).toFixed(3),
		(chunk.totalTailPaddingSec * 1000).toFixed(3),
	].join(','));

	const csvPath = path.join(outDir, 'padding_report.csv');
	await fs.writeFile(csvPath, `${csvHeader}\n${csvRows.join('\n')}\n`);
	console.log(`Wrote ${jsonPath}`);
	console.log(`Wrote ${csvPath}`);
	console.log('');
}

function printSummary(report: SummaryReport): void {
	console.log(`Input: ${report.inputPath}`);
	console.log(`Source duration: ${report.sourceDurationSec.toFixed(3)} s`);
	console.log(`Sample rate: ${report.sampleRate} Hz, channels: ${report.channels}`);
	console.log(`Chunks: ${report.chunkCount} (~${CHUNK_DURATION_SEC}s${OVERLAP_SEC > 0 ? `, +${OVERLAP_SEC * 1000} ms tail on non-final` : ', no overlap tail'})`);
	console.log('Chunk boundaries: source ffprobe packet scan (scanAudioFrames + inferFrameAlignedChunks)');
	console.log('Encoded chunk duration: ffprobe stream/format duration per Ogg chunk');
	console.log('');
	console.log('Timeline totals:');
	console.log(`  source duration:       ${report.sourceDurationSec.toFixed(3)} s`);
	console.log(`  sum manifest duration: ${report.sumManifestDurationSec.toFixed(3)} s (cnap index chunk lengths)`);
	console.log(`  sum ffprobe Ogg:       ${report.sumFfprobeChunkDurationSec.toFixed(3)} s (encoded files)`);
	console.log(`  sum decoded PCM:       ${report.sumDecodedDurationSec.toFixed(3)} s`);
	console.log(`  sum body (no ov):      ${report.sumBodyDurationSec.toFixed(3)} s`);
	console.log(`  body vs source:        ${report.longerThanSourceBySec >= 0 ? '+' : ''}${formatMs(report.longerThanSourceBySec)}`);
	console.log('');
	console.log('Head/tail padding totals (decoded PCM vs ffprobe chunk duration):');
	console.log(`  head zero:      ${formatMs(report.sumHeadZeroSec)}`);
	console.log(`  tail zero:      ${formatMs(report.sumTailZeroSec)}`);
	console.log(`  tail overrun:   ${formatMs(report.sumTailOverrunSec)} (decoded past ffprobe chunk duration)`);
	console.log(`  head total:     ${formatMs(report.sumTotalHeadPaddingSec)}`);
	console.log(`  tail total:     ${formatMs(report.sumTotalTailPaddingSec)}`);
	console.log(`  mean head/chunk: ${formatMs(report.meanHeadPaddingSec)}  max: ${formatMs(report.maxHeadPaddingSec)}`);
	console.log(`  mean tail/chunk: ${formatMs(report.meanTailPaddingSec)}  max: ${formatMs(report.maxTailPaddingSec)}`);
	console.log('');
}

async function main(): Promise<void> {
	const inputArg = process.argv[2] ?? DEFAULT_INPUT;
	const inputPath = path.resolve(inputArg);
	const verbose = process.argv.includes('--verbose');

	try {
		await fs.access(inputPath);
	} catch {
		console.error(`Input not found: ${inputPath}`);
		process.exit(1);
	}

	const ffmpegPath = await resolveFfmpeg();
	const ffprobePath = ffprobePathFromFfmpeg(ffmpegPath);
	const outDir = OUT_ROOT;
	await fs.rm(outDir, { recursive: true, force: true });
	await fs.mkdir(outDir, { recursive: true });

	const report = await analyzeInput(ffmpegPath, ffprobePath, inputPath, outDir);
	printSummary(report);

	if (verbose || report.chunkCount <= 40) {
		printPerChunkTable(report);
	} else {
		console.log(`Per-chunk table omitted (${report.chunkCount} chunks); see out/padding_report.csv`);
		console.log('');
	}

	await writeReports(report, outDir);

	const hasTailOverrun = report.sumTailOverrunSec > 1e-6;
	const hasHeadZero = report.sumHeadZeroSec > 1e-6;
	const bodyLonger = report.longerThanSourceBySec > 0.01;

	if (hasHeadZero) {
		console.log(`FINDING: ${formatMs(report.sumHeadZeroSec)} total head zero padding (Vorbis preskip on decode).`);
	}
	if (hasTailOverrun) {
		console.log(
			`FINDING: ${formatMs(report.sumTailOverrunSec)} total tail overrun`
				+ ` (${formatMs(report.meanTailPaddingSec)} mean tail padding/chunk including overrun).`,
		);
	}
	if (!hasHeadZero && !hasTailOverrun) {
		console.log('FINDING: no head zero padding or tail overrun detected.');
	}

	if (bodyLonger) {
		console.log(`RESULT: naive body concat is ${formatMs(report.longerThanSourceBySec)} longer than source.`);
		process.exitCode = 1;
		return;
	}

	console.log('RESULT: naive body concat duration matches source within 10 ms.');
}

main().catch((err) => {
	console.error(err instanceof Error ? err.message : err);
	process.exit(1);
});
