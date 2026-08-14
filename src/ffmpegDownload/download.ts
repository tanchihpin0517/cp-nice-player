import { createHash } from 'crypto';
import { createWriteStream } from 'fs';
import { rm } from 'fs/promises';
import type { Agent } from 'http';
import type { IncomingMessage } from 'http';
import * as https from 'https';
import { HttpsProxyAgent } from 'https-proxy-agent';
import * as vscode from 'vscode';

const MAX_REDIRECTS = 5;
const RESPONSE_TIMEOUT_MS = 60_000;

export interface DownloadRequest {
	url: string;
	destination: string;
	/** Lowercase hex SHA-256 the downloaded bytes must hash to. */
	expectedSha256: string;
	onProgress?: (receivedBytes: number, totalBytes: number | undefined) => void;
	token?: vscode.CancellationToken;
}

/**
 * VS Code's own `http.proxy` setting wins over the environment, matching how the
 * rest of the editor resolves a proxy.
 */
function resolveProxy(): { agent: Agent | undefined; rejectUnauthorized: boolean } {
	const http = vscode.workspace.getConfiguration('http');
	const rejectUnauthorized = http.get<boolean>('proxyStrictSSL') ?? true;
	const proxy =
		http.get<string>('proxy')?.trim() ||
		process.env.https_proxy ||
		process.env.HTTPS_PROXY ||
		process.env.http_proxy ||
		process.env.HTTP_PROXY;

	if (!proxy) {
		return { agent: undefined, rejectUnauthorized };
	}

	return {
		agent: new HttpsProxyAgent(proxy, { rejectUnauthorized }),
		rejectUnauthorized,
	};
}

function isRedirect(status: number | undefined): boolean {
	return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

/**
 * Follows redirects manually so every hop can be checked: GitHub hands release
 * downloads off to a storage host, and a plaintext hop would silently drop TLS.
 */
async function openStream(
	url: string,
	token: vscode.CancellationToken | undefined,
	onRequest: (request: ReturnType<typeof https.get>) => void,
): Promise<IncomingMessage> {
	const { agent, rejectUnauthorized } = resolveProxy();
	let current = url;

	for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
		if (!current.startsWith('https://')) {
			throw new Error(`Refusing to download over a non-HTTPS URL: ${current}`);
		}

		const response = await new Promise<IncomingMessage>((resolve, reject) => {
			const request = https.get(
				current,
				{ agent, rejectUnauthorized, headers: { 'user-agent': 'cp-nice-player' } },
				resolve,
			);
			request.on('error', reject);
			request.setTimeout(RESPONSE_TIMEOUT_MS, () => {
				request.destroy(new Error(`Timed out waiting for ${current}`));
			});
			onRequest(request);
			if (token?.isCancellationRequested) {
				request.destroy(new vscode.CancellationError());
			}
		});

		if (isRedirect(response.statusCode) && response.headers.location) {
			response.resume();
			current = new URL(response.headers.location, current).toString();
			continue;
		}

		if (response.statusCode !== 200) {
			response.resume();
			throw new Error(`Download failed: HTTP ${response.statusCode} for ${current}`);
		}

		return response;
	}

	throw new Error(`Too many redirects while downloading ${url}`);
}

/**
 * Downloads to `destination` and rejects unless the bytes hash to
 * `expectedSha256`. The hash is computed as the bytes stream past, so a
 * mismatch is caught without a second pass over ~100 MB.
 */
export async function downloadVerified(request: DownloadRequest): Promise<void> {
	const { url, destination, expectedSha256, onProgress, token } = request;

	let activeRequest: ReturnType<typeof https.get> | undefined;
	const cancelSubscription = token?.onCancellationRequested(() => {
		activeRequest?.destroy(new vscode.CancellationError());
	});

	try {
		const response = await openStream(url, token, (req) => {
			activeRequest = req;
		});

		const totalHeader = response.headers['content-length'];
		const totalBytes = totalHeader ? Number(totalHeader) : undefined;
		const hash = createHash('sha256');
		let received = 0;

		await new Promise<void>((resolve, reject) => {
			const file = createWriteStream(destination);
			const fail = (err: unknown) => {
				response.destroy();
				file.destroy();
				reject(err);
			};

			response.on('data', (chunk: Buffer) => {
				hash.update(chunk);
				received += chunk.length;
				onProgress?.(received, totalBytes);
			});
			response.on('error', fail);
			file.on('error', fail);
			file.on('finish', resolve);
			response.pipe(file);
		});

		if (totalBytes !== undefined && received !== totalBytes) {
			await discard(destination);
			throw new Error(
				`Download truncated: expected ${totalBytes} bytes but received ${received}.`,
			);
		}

		const actual = hash.digest('hex');
		if (actual !== expectedSha256) {
			await discard(destination);
			throw new Error(
				`Checksum mismatch for ${url}: expected ${expectedSha256}, got ${actual}. ` +
					'The download was discarded.',
			);
		}
	} finally {
		cancelSubscription?.dispose();
	}
}

/** Unverified bytes are never left on disk where a later run could mistake them for a good download. */
async function discard(destination: string): Promise<void> {
	await rm(destination, { force: true }).catch(() => undefined);
}
