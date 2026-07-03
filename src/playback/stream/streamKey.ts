import { createHash } from 'crypto';
import * as fs from 'fs/promises';
import {
	getChunkDurationSec,
	getCrossfadeMs,
	getPlaybackOggQuality,
} from '../../config';
import { EncodeFormat } from '../../encodeFormat';
import { getEffectiveEncodeFormat } from '../../ffmpegHost';

export function computeStreamCacheHash(
	fsPath: string,
	mtimeMs: number,
	size: number,
	format: EncodeFormat,
	oggQuality: number,
	chunkDurationSec: number,
	crossfadeMs: number,
): string {
	const payload = `${fsPath}\0${mtimeMs}\0${size}\0${format}\0${oggQuality}\0${chunkDurationSec}\0${crossfadeMs}`;
	return createHash('sha256').update(payload).digest('hex');
}

export async function computeStreamKey(fsPath: string): Promise<string> {
	const stat = await fs.stat(fsPath);
	const format = getEffectiveEncodeFormat();
	const oggQuality = getPlaybackOggQuality();
	const chunkDurationSec = getChunkDurationSec();
	const crossfadeMs = getCrossfadeMs();
	return computeStreamCacheHash(
		fsPath,
		stat.mtimeMs,
		stat.size,
		format,
		oggQuality,
		chunkDurationSec,
		crossfadeMs,
	);
}
