export type PlaybackServerState =
	| 'stopped'
	| 'starting'
	| 'listening'
	| 'failed'
	| 'disposed';

export interface HostReachability {
	ok: boolean;
	httpStatus?: number;
	elapsedMs?: number;
	error?: string;
	checkedAt: number;
}

export interface FfmpegStatus {
	available: boolean;
	path: string;
	version?: string;
	encodeFormat?: string;
	error?: string;
}

export interface PlaybackServerStatus {
	state: PlaybackServerState;
	port?: number;
	/** http://127.0.0.1:<port> — the address the extension host probes. */
	localUrl?: string;
	/** asExternalUri result — the address the webview fetches from. */
	externalUrl?: string;
	/** True when externalUrl differs from localUrl (remote tunnel / port forward). */
	urlForwarded: boolean;
	registeredAudioCount: number;
	startedAt?: number;
	lastError?: string;
	ffmpeg: FfmpegStatus;
	hostReachable?: HostReachability;
}

export function localUrlForPort(port: number): string {
	return `http://127.0.0.1:${port}`;
}
