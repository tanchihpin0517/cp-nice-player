/*
 * Webview entry point. Owns the extension-host message channel and nothing else;
 * the interface itself lives in playerView.js, which is deliberately unaware of
 * vscode so it can run in the standalone demo under docs/design/player.
 */
const vscode = acquireVsCodeApi();
const engine = new StreamingAudioEngine();

const STREAM_ERROR_REPORT_INTERVAL_MS = 2000;
let lastStreamErrorReportAt = 0;
let currentMessage = null;

/**
 * Tells the extension a fetch failed so it replies with a freshly probed status.
 * Throttled because the engine retries the index once a second.
 */
function reportStreamError(message) {
	const now = Date.now();
	if (now - lastStreamErrorReportAt < STREAM_ERROR_REPORT_INTERVAL_MS) {
		return;
	}
	lastStreamErrorReportAt = now;
	vscode.postMessage({ type: 'streamError', message });
}

const view = new PlayerView(document.getElementById('player'), engine, {
	onStreamError: reportStreamError,
	onServerRefresh: () => vscode.postMessage({ type: 'requestServerStatus' }),
	onServerRestart: () => vscode.postMessage({ type: 'restartServer' }),
	onRetry: () => {
		if (currentMessage) {
			void view.loadMedia(currentMessage);
		}
	},
	onInspectorToggle: (open) => {
		vscode.setState({ ...(vscode.getState() ?? {}), inspectorOpen: open });
	},
});

window.addEventListener('message', (event) => {
	const message = event.data;
	if (message?.type === 'loadMedia') {
		currentMessage = message;
		void view.loadMedia(message);
		return;
	}
	if (message?.type === 'serverStatus') {
		view.setServerStatus(message.status);
	}
});

const savedState = vscode.getState();
if (savedState && 'inspectorOpen' in savedState) {
	view.setInspectorOpen(Boolean(savedState.inspectorOpen));
}

vscode.postMessage({ type: 'ready' });
