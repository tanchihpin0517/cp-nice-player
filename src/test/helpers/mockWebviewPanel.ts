import * as vscode from 'vscode';

export interface MockWebviewCapture {
	panel: vscode.WebviewPanel;
	postedMessages: unknown[];
	disposables: vscode.Disposable[];
	receiveMessage: (message: unknown) => void;
}

export function createMockWebviewPanel(_extensionUri: vscode.Uri): MockWebviewCapture {
	const postedMessages: unknown[] = [];
	const disposables: vscode.Disposable[] = [];
	let messageHandler: ((message: unknown) => void) | null = null;

	const webview = {
		html: '',
		cspSource: 'vscode-webview:',
		postMessage(message: unknown) {
			postedMessages.push(message);
		},
		asWebviewUri(uri: vscode.Uri) {
			return uri.with({ scheme: 'vscode-webview' });
		},
		onDidReceiveMessage(
			callback: (message: unknown) => void,
			_thisArg?: unknown,
			disposableList?: vscode.Disposable[],
		) {
			messageHandler = callback;
			const disposable = {
				dispose: () => {
					messageHandler = null;
				},
			};
			disposables.push(disposable);
			disposableList?.push(disposable);
			return disposable;
		},
	};

	const panel = {
		webview,
	} as unknown as vscode.WebviewPanel;

	return {
		panel,
		postedMessages,
		disposables,
		receiveMessage(message: unknown) {
			messageHandler?.(message);
		},
	};
}
