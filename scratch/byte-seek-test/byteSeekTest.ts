import { execFile, spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const OUT_DIR = path.join(__dirname, 'out');
const CHUNK_TARGET_SEC = 1;
const DURATION_TOLERANCE_SEC = 0.15;

interface AudioPacket {
	index: number;
	ptsTimeSec: number;
	bytePos: number;
	sizeBytes: number;
	durationSec: number;
}

interface ChunkSlice {
	startSec: number;
	endSec: number;
	durationSec: number;
	startByte: number;
	endByte: number;
	startPacketIndex: number;
	endPacketIndex: number;
	packetCount: number;
}

interface SliceResult {
	label: string;
	elapsedMs: number;
	outputPath: string;
	durationSec: number;
	bytesWritten: number;
	supported: boolean;
	note?: string;
}

function ffprobePathFromFfmpeg(ffmpegPath: string): string {
	if (ffmpegPath.endsWith('ffmpeg')) {
		return ffmpegPath.slice(0, -'ffmpeg'.length) + 'ffprobe';
	}
	if (ffmpegPath.endsWith('ffmpeg.exe')) {
		return ffmpegPath.slice(0, -'ffmpeg.exe'.length) + 'ffprobe.exe';
	}
	return 'ffprobe';
}

async function resolveFfmpeg(): Promise<string> {
	try {
		await execFileAsync('ffmpeg', ['-version'], { timeout: 5000 });
		return 'ffmpeg';
	} catch {
		throw new Error('ffmpeg was not found on PATH.');
	}
}

function ffmpegSupportsByteSeek(ffmpegPath: string): Promise<boolean> {
	return new Promise((resolve) => {
		const proc = spawn(ffmpegPath, ['-hide_banner', '-h'], { stdio: ['ignore', 'pipe', 'pipe'] });
		let output = '';
		proc.stdout.setEncoding('utf8');
		proc.stderr.setEncoding('utf8');
		proc.stdout.on('data', (chunk: string) => {
			output += chunk;
		});
		proc.stderr.on('data', (chunk: string) => {
			output += chunk;
		});
		proc.on('error', () => resolve(false));
		proc.on('close', () => resolve(output.includes('byte_seek')));
	});
}

async function scanAudioPackets(ffprobePath: string, inputPath: string): Promise<AudioPacket[]> {
	const { stdout } = await execFileAsync(
		ffprobePath,
		[
			'-v',
			'quiet',
			'-print_format',
			'json',
			'-show_packets',
			'-select_streams',
			'a:0',
			inputPath,
		],
		{ timeout: 60000, maxBuffer: 128 * 1024 * 1024 },
	);

	const parsed = JSON.parse(stdout) as {
		packets?: Array<{
			codec_type?: string;
			pts_time?: string;
			duration_time?: string;
			pos?: string;
			size?: string;
		}>;
	};

	const audioRaw = (parsed.packets ?? []).filter((packet) => packet.codec_type === 'audio');
	const packets: AudioPacket[] = [];

	for (let i = 0; i < audioRaw.length; i += 1) {
		const packet = audioRaw[i];
		const ptsTimeSec = Number.parseFloat(packet.pts_time ?? '');
		const bytePos = Number.parseInt(packet.pos ?? '', 10);
		const sizeBytes = Number.parseInt(packet.size ?? '', 10);
		if (!Number.isFinite(ptsTimeSec) || !Number.isInteger(bytePos) || !Number.isInteger(sizeBytes) || sizeBytes <= 0) {
			continue;
		}

		let durationSec = Number.parseFloat(packet.duration_time ?? '');
		if (!Number.isFinite(durationSec) || durationSec <= 0) {
			const nextPts = Number.parseFloat(audioRaw[i + 1]?.pts_time ?? '');
			if (Number.isFinite(nextPts) && nextPts > ptsTimeSec) {
				durationSec = nextPts - ptsTimeSec;
			}
		}
		if (!Number.isFinite(durationSec) || durationSec <= 0) {
			continue;
		}

		packets.push({
			index: packets.length,
			ptsTimeSec,
			bytePos,
			sizeBytes,
			durationSec,
		});
	}

	if (packets.length === 0) {
		throw new Error(`No audio packets with byte positions found in ${inputPath}`);
	}

	return packets;
}

function pickMiddleChunk(packets: AudioPacket[], targetSec: number): ChunkSlice {
	const totalDurationSec =
		packets[packets.length - 1].ptsTimeSec + packets[packets.length - 1].durationSec - packets[0].ptsTimeSec;
	const targetStartSec = Math.max(packets[0].ptsTimeSec, totalDurationSec * 0.6);

	let startIdx = packets.findIndex((packet) => packet.ptsTimeSec >= targetStartSec);
	if (startIdx < 0) {
		startIdx = Math.floor(packets.length / 2);
	}

	let endIdx = startIdx;
	let spanSec = 0;
	while (endIdx + 1 < packets.length && spanSec < targetSec) {
		spanSec = packets[endIdx + 1].ptsTimeSec + packets[endIdx + 1].durationSec - packets[startIdx].ptsTimeSec;
		endIdx += 1;
	}

	const startPacket = packets[startIdx];
	const endPacket = packets[endIdx];
	const endSec = endPacket.ptsTimeSec + endPacket.durationSec;

	return {
		startSec: startPacket.ptsTimeSec,
		endSec,
		durationSec: endSec - startPacket.ptsTimeSec,
		startByte: startPacket.bytePos,
		endByte: endPacket.bytePos + endPacket.sizeBytes - 1,
		startPacketIndex: startPacket.index,
		endPacketIndex: endPacket.index,
		packetCount: endPacket.index - startPacket.index + 1,
	};
}

async function runFfmpeg(ffmpegPath: string, args: string[]): Promise<void> {
	await new Promise<void>((resolve, reject) => {
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
				const command = [ffmpegPath, ...args].join(' ');
				const detail = stderr.trim() || `ffmpeg exited with code ${code}`;
				reject(new Error(`${detail}\ncommand: ${command}`));
			}
		});
	});
}

async function runFfmpegTimed(ffmpegPath: string, args: string[]): Promise<number> {
	const started = performance.now();
	await runFfmpeg(ffmpegPath, args);
	return performance.now() - started;
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

async function transcodeInputTimeRange(
	ffmpegPath: string,
	inputPath: string,
	outputPath: string,
	chunk: ChunkSlice,
): Promise<number> {
	return runFfmpegTimed(ffmpegPath, [
		'-y',
		'-nostats',
		'-loglevel',
		'quiet',
		'-accurate_seek',
		'-ss',
		String(chunk.startSec),
		'-to',
		String(chunk.endSec),
		'-i',
		inputPath,
		'-vn',
		'-c:a',
		'libvorbis',
		'-q:a',
		'6',
		outputPath,
	]);
}

async function transcodeOutputTimeRange(
	ffmpegPath: string,
	inputPath: string,
	outputPath: string,
	chunk: ChunkSlice,
): Promise<number> {
	return runFfmpegTimed(ffmpegPath, [
		'-y',
		'-nostats',
		'-loglevel',
		'quiet',
		'-i',
		inputPath,
		'-ss',
		String(chunk.startSec),
		'-t',
		String(chunk.durationSec),
		'-vn',
		'-c:a',
		'libvorbis',
		'-q:a',
		'6',
		outputPath,
	]);
}

async function transcodeByteSeekWithDuration(
	ffmpegPath: string,
	inputPath: string,
	outputPath: string,
	chunk: ChunkSlice,
): Promise<{ elapsedMs: number; supported: boolean; note?: string }> {
	const args = [
		'-y',
		'-nostats',
		'-loglevel',
		'quiet',
		'-byte_seek',
		'1',
		'-ss',
		`${chunk.startByte}B`,
		'-i',
		inputPath,
		'-t',
		String(chunk.durationSec),
		'-vn',
		'-c:a',
		'libvorbis',
		'-q:a',
		'6',
		outputPath,
	];

	try {
		const elapsedMs = await runFfmpegTimed(ffmpegPath, args);
		return { elapsedMs, supported: true };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		if (message.includes('byte_seek') || message.includes('Option not found')) {
			return {
				elapsedMs: 0,
				supported: false,
				note: 'This ffmpeg build has no -byte_seek flag; indexed PTS + -ss before -i is the CLI fallback.',
			};
		}
		throw err;
	}
}

async function transcodePacketCountWithFramesA(
	ffmpegPath: string,
	inputPath: string,
	outputPath: string,
	chunk: ChunkSlice,
): Promise<number> {
	return runFfmpegTimed(ffmpegPath, [
		'-y',
		'-nostats',
		'-loglevel',
		'quiet',
		'-ss',
		String(chunk.startSec),
		'-i',
		inputPath,
		'-frames:a',
		String(chunk.packetCount),
		'-vn',
		'-c:a',
		'libvorbis',
		'-q:a',
		'6',
		outputPath,
	]);
}

async function buildResult(
	label: string,
	outputPath: string,
	ffprobePath: string,
	elapsedMs: number,
	supported = true,
	note?: string,
): Promise<SliceResult> {
	const stat = await fs.stat(outputPath);
	const durationSec = await probeDuration(ffprobePath, outputPath);
	return {
		label,
		elapsedMs,
		outputPath,
		durationSec,
		bytesWritten: stat.size,
		supported,
		note,
	};
}

function formatMs(ms: number): string {
	return `${ms.toFixed(0)} ms`;
}

function printChunk(chunk: ChunkSlice): void {
	console.log('Selected chunk (from ffprobe packet index):');
	console.log(`  startSec=${chunk.startSec.toFixed(3)} endSec=${chunk.endSec.toFixed(3)} duration=${chunk.durationSec.toFixed(3)}s`);
	console.log(`  startByte=${chunk.startByte} endByte=${chunk.endByte}`);
	console.log(
		`  packetIndex ${chunk.startPacketIndex}..${chunk.endPacketIndex} (${chunk.packetCount} ffprobe packets)`,
	);
	console.log('');
}

function printResults(results: SliceResult[]): void {
	console.log('Results:');
	for (const result of results) {
		const status = result.supported ? 'ok' : 'skipped';
		console.log(`  [${status}] ${result.label}`);
		if (!result.supported) {
			console.log(`         ${result.note ?? 'unsupported on this ffmpeg build'}`);
			continue;
		}
		console.log(
			`         duration=${result.durationSec.toFixed(3)}s bytes=${result.bytesWritten} elapsed=${formatMs(result.elapsedMs)}`,
		);
		console.log(`         ${result.outputPath}`);
	}
	console.log('');
}

async function main(): Promise<void> {
	const inputArg = process.argv[2];
	if (!inputArg) {
		console.error('Usage: byteSeekTest.ts <input-media-path>');
		process.exit(1);
	}
	const inputPath = path.resolve(inputArg);
	const ffmpegPath = await resolveFfmpeg();
	const ffprobePath = ffprobePathFromFfmpeg(ffmpegPath);
	const byteSeekFlag = await ffmpegSupportsByteSeek(ffmpegPath);

	await fs.mkdir(OUT_DIR, { recursive: true });

	console.log(`Input: ${inputPath}`);
	console.log(`FFmpeg: ${ffmpegPath}`);
	console.log(`-byte_seek supported: ${byteSeekFlag ? 'yes' : 'no'}`);
	console.log('');

	const packets = await scanAudioPackets(ffprobePath, inputPath);
	const chunk = pickMiddleChunk(packets, CHUNK_TARGET_SEC);
	printChunk(chunk);

	const inputTimePath = path.join(OUT_DIR, 'slice_input_time.ogg');
	const outputTimePath = path.join(OUT_DIR, 'slice_output_time.ogg');
	const byteSeekPath = path.join(OUT_DIR, 'slice_byte_seek.ogg');
	const framesAPath = path.join(OUT_DIR, 'slice_frames_a.ogg');

	const results: SliceResult[] = [];

	const inputTimeMs = await transcodeInputTimeRange(ffmpegPath, inputPath, inputTimePath, chunk);
	results.push(
		await buildResult('input time seek (-ss/-to before -i)', inputTimePath, ffprobePath, inputTimeMs),
	);

	const outputTimeMs = await transcodeOutputTimeRange(ffmpegPath, inputPath, outputTimePath, chunk);
	results.push(
		await buildResult(
			'output time seek (-ss after -i, decode-from-start path)',
			outputTimePath,
			ffprobePath,
			outputTimeMs,
		),
	);

	const byteSeek = await transcodeByteSeekWithDuration(ffmpegPath, inputPath, byteSeekPath, chunk);
	if (byteSeek.supported) {
		results.push(
			await buildResult(
				'byte seek (-byte_seek 1 -ss {byte}B -t duration)',
				byteSeekPath,
				ffprobePath,
				byteSeek.elapsedMs,
			),
		);
	} else {
		results.push({
			label: 'byte seek (-byte_seek 1 -ss {byte}B -t duration)',
			elapsedMs: 0,
			outputPath: byteSeekPath,
			durationSec: 0,
			bytesWritten: 0,
			supported: false,
			note: byteSeek.note,
		});
	}

	const framesAMs = await transcodePacketCountWithFramesA(ffmpegPath, inputPath, framesAPath, chunk);
	const framesAResult = await buildResult(
		'packet-count as -frames:a (informational only)',
		framesAPath,
		ffprobePath,
		framesAMs,
	);
	framesAResult.note =
		'ffprobe packet count != ffmpeg -frames:a; do not use packetCount directly as -frames:a.';
	results.push(framesAResult);

	printResults(results);

	const comparable = results.filter(
		(result) =>
			result.supported &&
			!result.label.includes('informational') &&
			!result.label.includes('output time'),
	);
	const baseline = comparable[0]?.durationSec ?? 0;
	let failed = false;

	for (const result of comparable.slice(1)) {
		const delta = Math.abs(result.durationSec - baseline);
		if (delta > DURATION_TOLERANCE_SEC) {
			console.error(
				`FAIL: ${result.label} duration ${result.durationSec.toFixed(3)}s differs from baseline ${baseline.toFixed(3)}s by ${delta.toFixed(3)}s`,
			);
			failed = true;
		}
	}

	const inputSeek = results.find((result) => result.label.startsWith('input time'));
	const outputSeek = results.find((result) => result.label.startsWith('output time'));
	if (inputSeek?.supported && outputSeek?.supported) {
		const ratio = outputSeek.elapsedMs / Math.max(inputSeek.elapsedMs, 1);
		console.log(
			`Seek placement: input -ss ${formatMs(inputSeek.elapsedMs)} vs output -ss ${formatMs(outputSeek.elapsedMs)} (${ratio.toFixed(1)}x slower)`,
		);
	}

	const framesA = results.find((result) => result.label.includes('informational'));
	if (framesA?.supported && inputSeek?.supported) {
		console.log(
			`Note: -frames:a ${chunk.packetCount} produced ${framesA.durationSec.toFixed(3)}s, expected ~${chunk.durationSec.toFixed(3)}s from index.`,
		);
	}

	if (failed) {
		process.exitCode = 1;
		return;
	}

	console.log('PASS: input time seek matches byte seek within tolerance (when byte seek is supported).');
	if (!byteSeekFlag) {
		console.log('PASS: input time seek baseline succeeded; byte CLI flag not available on this ffmpeg build.');
	}
}

void main().catch((err) => {
	console.error(err instanceof Error ? err.message : String(err));
	process.exit(1);
});
