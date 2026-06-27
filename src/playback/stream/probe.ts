import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface ProbeResult {
	durationSec: number;
	channels: number;
	sampleRate: number;
}

export interface AudioPacket {
	index: number;
	ptsTimeSec: number;
	bytePos: number;
	sizeBytes: number;
	durationSec: number;
}

export interface FrameScanResult {
	probe: ProbeResult;
	fileSize: number;
	packets: AudioPacket[];
}

interface RawPacket {
	codec_type?: string;
	pts_time?: string;
	duration_time?: string;
	pos?: string;
	size?: string;
}

interface FfprobeScanJson {
	packets?: RawPacket[];
}

export function ffprobePathFromFfmpeg(ffmpegPath: string): string {
	if (ffmpegPath.endsWith('ffmpeg')) {
		return ffmpegPath.slice(0, -'ffmpeg'.length) + 'ffprobe';
	}
	if (ffmpegPath.endsWith('ffmpeg.exe')) {
		return ffmpegPath.slice(0, -'ffmpeg.exe'.length) + 'ffprobe.exe';
	}
	return 'ffprobe';
}

function parseStreamMetadata(stdout: string): Pick<ProbeResult, 'channels' | 'sampleRate'> | undefined {
	let data: {
		streams?: Array<{ codec_type?: string; channels?: number; sample_rate?: string }>;
	};
	try {
		data = JSON.parse(stdout);
	} catch {
		return undefined;
	}

	const audioStream = data.streams?.find((stream) => stream.codec_type === 'audio');
	if (!audioStream) {
		return undefined;
	}

	const channels = audioStream.channels;
	const sampleRate = audioStream.sample_rate
		? Number.parseInt(audioStream.sample_rate, 10)
		: undefined;

	if (
		channels === undefined ||
		channels <= 0 ||
		sampleRate === undefined ||
		sampleRate <= 0
	) {
		return undefined;
	}

	return { channels, sampleRate };
}

export function durationFromPackets(packets: AudioPacket[]): number {
	if (packets.length === 0) {
		throw new Error('Cannot compute duration from empty packets');
	}

	const first = packets[0];
	const last = packets[packets.length - 1];
	return last.ptsTimeSec + last.durationSec - first.ptsTimeSec;
}

function parsePositiveNumber(value: string | undefined): number | undefined {
	if (value === undefined) {
		return undefined;
	}
	const parsed = Number.parseFloat(value);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function parsePositiveInteger(value: string | undefined): number | undefined {
	if (value === undefined) {
		return undefined;
	}
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function normalizePackets(rawPackets: RawPacket[]): AudioPacket[] {
	const audioRaw = rawPackets.filter((packet) => packet.codec_type === 'audio');
	const packets: AudioPacket[] = [];
	for (let i = 0; i < audioRaw.length; i += 1) {
		const packet = audioRaw[i];
		const ptsTimeSec = parsePositiveNumber(packet.pts_time);
		const bytePos = parsePositiveInteger(packet.pos);
		const sizeBytes = parsePositiveInteger(packet.size);
		if (ptsTimeSec === undefined || bytePos === undefined || sizeBytes === undefined || sizeBytes <= 0) {
			continue;
		}

		let durationSec = parsePositiveNumber(packet.duration_time);
		if (durationSec === undefined || durationSec <= 0) {
			const nextPts = parsePositiveNumber(audioRaw[i + 1]?.pts_time);
			if (nextPts !== undefined && nextPts > ptsTimeSec) {
				durationSec = nextPts - ptsTimeSec;
			}
		}

		if (durationSec === undefined || durationSec <= 0) {
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
	return packets;
}

async function probeAndScanWithFfprobe(
	ffprobePath: string,
	fsPath: string,
): Promise<{ probe: ProbeResult; packets: AudioPacket[] }> {
	const { stdout } = await execFileAsync(
		ffprobePath,
		[
			'-v',
			'quiet',
			'-print_format',
			'json',
			'-show_format',
			'-show_streams',
			'-show_packets',
			'-select_streams',
			'a:0',
			fsPath,
		],
		{ timeout: 20000, maxBuffer: 128 * 1024 * 1024 },
	);

	const metadata = parseStreamMetadata(stdout);
	if (!metadata) {
		throw new Error(`Failed to probe audio metadata for: ${fsPath}`);
	}

	const parsed = JSON.parse(stdout) as FfprobeScanJson;
	const packets = normalizePackets(parsed.packets ?? []);
	if (packets.length === 0) {
		throw new Error(`Failed to scan audio packets with positions for: ${fsPath}`);
	}

	const probe: ProbeResult = {
		...metadata,
		durationSec: durationFromPackets(packets),
	};

	return { probe, packets };
}

export async function scanAudioFrames(ffmpegPath: string, fsPath: string): Promise<FrameScanResult> {
	const ffprobePath = ffprobePathFromFfmpeg(ffmpegPath);
	const [scan, stat] = await Promise.all([
		probeAndScanWithFfprobe(ffprobePath, fsPath),
		fs.stat(fsPath),
	]);

	return {
		probe: scan.probe,
		fileSize: stat.size,
		packets: scan.packets,
	};
}
