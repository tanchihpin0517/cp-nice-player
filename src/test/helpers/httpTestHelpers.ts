import * as http from 'http';
import { IncomingMessage, ServerResponse } from 'http';

export interface MockHttpResponse {
	statusCode: number;
	headers: http.OutgoingHttpHeaders;
	body: Buffer;
}

export function createMockRequest(
	url: string,
	options: { method?: string; origin?: string } = {},
): IncomingMessage {
	return {
		method: options.method ?? 'GET',
		url,
		headers: options.origin ? { origin: options.origin } : {},
	} as IncomingMessage;
}

export function createCollectingResponse(): {
	res: ServerResponse;
	result: () => Promise<MockHttpResponse>;
} {
	const chunks: Buffer[] = [];
	let statusCode = 0;
	let headers: http.OutgoingHttpHeaders = {};
	let resolveResult: (value: MockHttpResponse) => void;
	const resultPromise = new Promise<MockHttpResponse>((resolve) => {
		resolveResult = resolve;
	});

	const res = {
		writeHead(code: number, responseHeaders?: http.OutgoingHttpHeaders) {
			statusCode = code;
			headers = {};
			if (responseHeaders) {
				for (const [name, value] of Object.entries(responseHeaders)) {
					headers[name.toLowerCase()] = value;
				}
			}
		},
		setHeader(name: string, value: string | number | readonly string[]) {
			headers[name.toLowerCase()] = value as string | number | string[];
		},
		end(body?: string | Buffer) {
			if (body !== undefined) {
				chunks.push(Buffer.isBuffer(body) ? body : Buffer.from(body));
			}
			resolveResult({
				statusCode,
				headers,
				body: Buffer.concat(chunks),
			});
		},
	} as unknown as ServerResponse;

	return {
		res,
		result: () => resultPromise,
	};
}

export function httpGet(
	port: number,
	pathname: string,
	options: { method?: string; origin?: string } = {},
): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
	return new Promise((resolve, reject) => {
		const req = http.request(
			{
				hostname: '127.0.0.1',
				port,
				path: pathname,
				method: options.method ?? 'GET',
				headers: options.origin ? { Origin: options.origin } : undefined,
			},
			(res) => {
				const chunks: Buffer[] = [];
				res.on('data', (chunk: Buffer) => chunks.push(chunk));
				res.on('end', () => {
					resolve({
						statusCode: res.statusCode ?? 0,
						headers: res.headers,
						body: Buffer.concat(chunks),
					});
				});
			},
		);
		req.on('error', reject);
		req.end();
	});
}
