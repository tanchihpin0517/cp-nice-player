/*
 * DEMO ONLY — not shipped.
 *
 * Plays the role the extension host plays in the real thing: it picks a track,
 * hands the view a loadMedia message, answers status requests, and lets you
 * force the failure modes that are otherwise hard to reproduce.
 */

const THEME_KINDS = {
  'dark-modern': 'vscode-dark',
  'light-modern': 'vscode-light',
  'hc-dark': 'vscode-high-contrast',
  dracula: 'vscode-dark',
  'solarized-light': 'vscode-light',
  monokai: 'vscode-dark',
};

// file:// origins can be opaque, where localStorage throws instead of returning null.
const store = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* preference is not worth failing the demo over */
    }
  },
};

const engine = new MockEngine();
const root = document.getElementById('player');
const cpRoot = document.getElementById('cpRoot');

const ui = {
  theme: document.getElementById('demoTheme'),
  track: document.getElementById('demoTrack'),
  width: document.getElementById('demoWidth'),
  latency: document.getElementById('demoLatency'),
  latencyValue: document.getElementById('demoLatencyValue'),
  failIndex: document.getElementById('demoFailIndex'),
  failChunks: document.getElementById('demoFailChunks'),
  noFfmpeg: document.getElementById('demoNoFfmpeg'),
  reload: document.getElementById('demoReload'),
  empty: document.getElementById('demoEmpty'),
};

const view = new PlayerView(root, engine, {
  onServerRefresh: () => pushServerStatus(),
  onServerRestart: () => {
    pushServerStatus({ state: 'starting' });
    setTimeout(() => pushServerStatus({ lastError: undefined }), 700);
  },
  onStreamError: (message) => pushServerStatus({ lastError: message }),
  onRetry: () => loadSelectedTrack(),
  onInspectorToggle: (open) => store.set('cp-demo-inspector', String(open)),
});

// ---------------------------------------------------------------- controls

for (const track of DEMO_TRACKS) {
  const option = document.createElement('option');
  option.value = track.id;
  option.textContent = track.name;
  ui.track.appendChild(option);
}

ui.theme.addEventListener('change', () => applyTheme(ui.theme.value));
ui.track.addEventListener('change', () => loadSelectedTrack());
ui.reload.addEventListener('click', () => loadSelectedTrack());

ui.width.addEventListener('change', () => {
  cpRoot.dataset.width = ui.width.value;
});

ui.latency.addEventListener('input', () => {
  engine.scenario.latencyMs = Number(ui.latency.value);
  ui.latencyValue.textContent = ui.latency.value + 'ms';
});

ui.failIndex.addEventListener('change', () => {
  engine.scenario.failIndex = ui.failIndex.checked;
});

ui.failChunks.addEventListener('change', () => {
  engine.scenario.failChunks = ui.failChunks.checked;
});

ui.noFfmpeg.addEventListener('change', () => pushServerStatus());

ui.empty.addEventListener('click', () => {
  void engine.pause();
  engine.manifest = null;
  view.context = null;
  view.setState('empty');
  view.setStatus('Waiting for a file', 'idle');
  view.setControlsEnabled(false);
  view.renderPlaybackPanel();
});

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  document.body.className = THEME_KINDS[theme] ?? 'vscode-dark';
  store.set('cp-demo-theme', theme);
  // Canvas colours are read from CSS, so they need an explicit re-read.
  view.refreshTheme();
}

// ------------------------------------------------------------------- load

function loadSelectedTrack() {
  const track = DEMO_TRACKS.find((t) => t.id === ui.track.value) ?? DEMO_TRACKS[0];
  pushServerStatus();
  void view.loadMedia({
    type: 'loadMedia',
    name: track.name,
    audioId: track.id,
    serverUrl: 'http://127.0.0.1:41233',
    duration: track.duration,
    debug: {
      fsPath: track.fsPath,
      playbackFormat: track.playbackFormat,
      chunkDurationSec: 1,
      chunkBufferCount: 5,
      maxEncodedChunks: 64,
    },
  });
}

let serverStatus = {
  state: 'listening',
  externalUrl: 'http://127.0.0.1:41233',
  localUrl: 'http://127.0.0.1:41233',
  urlForwarded: false,
  registeredAudioCount: 1,
  hostReachable: { ok: true, elapsedMs: 3 },
  ffmpeg: {
    available: true,
    path: '/usr/bin/ffmpeg',
    version: '7.1',
    encodeFormat: 'ogg',
  },
  lastError: undefined,
};

function pushServerStatus(patch = {}) {
  serverStatus = { ...serverStatus, ...patch };
  const status = { ...serverStatus };

  if (ui.noFfmpeg.checked) {
    status.ffmpeg = { available: false, error: 'spawn ffmpeg ENOENT' };
    status.lastError = status.lastError ?? 'transcode failed: ffmpeg not found on PATH';
  }
  if (engine.scenario.failIndex) {
    status.hostReachable = { ok: false, error: 'ECONNREFUSED' };
  }

  view.setServerStatus(status);
}

// ------------------------------------------------------------------- boot

applyTheme(store.get('cp-demo-theme') ?? 'dark-modern');
ui.theme.value = document.documentElement.dataset.theme;
cpRoot.dataset.width = ui.width.value;
view.setInspectorOpen(store.get('cp-demo-inspector') === 'true');
loadSelectedTrack();

// Handy for poking at state from the browser console while evaluating the design.
window.__view = view;
window.__engine = engine;
