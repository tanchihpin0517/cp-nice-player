const vscode = acquireVsCodeApi();
const trackName = document.getElementById('trackName');
const trackState = document.getElementById('trackState');
const emptyState = document.getElementById('emptyState');
const playbackPlayPause = document.getElementById('playbackPlayPause');
const playbackSeek = document.getElementById('playbackSeek');
const playbackCurrentTime = document.getElementById('playbackCurrentTime');
const playbackDuration = document.getElementById('playbackDuration');
const playbackVolume = document.getElementById('playbackVolume');
const playbackMuted = document.getElementById('playbackMuted');
const debugGrid = document.getElementById('debugGrid');
const debugLog = document.getElementById('debugLog');
const debugPanel = document.getElementById('debugPanel');
const serverGrid = document.getElementById('serverGrid');
const serverRefresh = document.getElementById('serverRefresh');
const serverRestart = document.getElementById('serverRestart');

const engine = new StreamingAudioEngine();
let debugContext = null;
let serverStatus = null;
let lastStreamErrorReportAt = 0;
let pendingSeekDrag = false;
const eventLog = [];
const MAX_LOG_ENTRIES = 30;
const STREAM_ERROR_REPORT_INTERVAL_MS = 2000;

function logEvent(name, detail) {
  const timestamp = new Date().toLocaleTimeString();
  eventLog.unshift({ timestamp, name, detail });
  if (eventLog.length > MAX_LOG_ENTRIES) {
    eventLog.length = MAX_LOG_ENTRIES;
  }
  renderEventLog();
}

function renderEventLog() {
  debugLog.innerHTML = eventLog.map((entry) => {
    const detail = entry.detail ? ' <span class="event-detail">' + escapeHtml(entry.detail) + '</span>' : '';
    return '<li>[' + escapeHtml(entry.timestamp) + '] <span class="event-name">' + escapeHtml(entry.name) + '</span>' + detail + '</li>';
  }).join('');
}

function renderDebugField(label, value, tone) {
  const cls = tone ? ' class="' + tone + '"' : '';
  return '<dt>' + escapeHtml(label) + '</dt><dd' + cls + '>' + escapeHtml(value ?? '—') + '</dd>';
}

// The extension host reports server state over the webview message channel, which does not go
// through the playback server. So these rows stay accurate even when every fetch is failing —
// that is the whole point of the panel.
function updateServerPanel() {
  if (!serverStatus) {
    serverGrid.innerHTML = renderDebugField('state', 'unknown (no report from extension)', 'bad');
    return;
  }

  const status = serverStatus;
  const fields = [renderDebugField('state', status.state, status.state === 'listening' ? 'ok' : 'bad')];

  if (status.externalUrl) {
    fields.push(renderDebugField('url', status.externalUrl));
  }
  if (status.urlForwarded && status.localUrl) {
    fields.push(renderDebugField('local url', status.localUrl + ' (forwarded)'));
  }

  fields.push(renderDebugField(
    'host reachable',
    formatHostReachable(status.hostReachable),
    status.hostReachable ? (status.hostReachable.ok ? 'ok' : 'bad') : undefined,
  ));
  fields.push(renderDebugField('registered audio', String(status.registeredAudioCount ?? 0)));
  fields.push(renderDebugField(
    'ffmpeg',
    formatFfmpegStatus(status.ffmpeg),
    status.ffmpeg && !status.ffmpeg.available ? 'bad' : undefined,
  ));
  fields.push(renderDebugField('last error', status.lastError, status.lastError ? 'bad' : undefined));

  serverGrid.innerHTML = fields.join('');
}

function formatHostReachable(reachable) {
  if (!reachable) {
    return 'not checked';
  }
  if (reachable.ok) {
    return 'ok (' + (reachable.elapsedMs ?? 0) + 'ms)';
  }
  return 'failed: ' + (reachable.error ?? 'HTTP ' + reachable.httpStatus);
}

function formatFfmpegStatus(ffmpeg) {
  if (!ffmpeg) {
    return '—';
  }
  if (!ffmpeg.available) {
    return 'unavailable: ' + (ffmpeg.error ?? 'unknown reason');
  }
  let text = ffmpeg.path;
  if (ffmpeg.version) {
    text += ' (' + ffmpeg.version + ')';
  }
  if (ffmpeg.encodeFormat) {
    text += ' → ' + ffmpeg.encodeFormat;
  }
  return text;
}

// Tells the extension a fetch failed so it replies with a freshly probed status. Throttled
// because the engine retries the index once a second.
function reportStreamError(message) {
  const now = Date.now();
  if (now - lastStreamErrorReportAt < STREAM_ERROR_REPORT_INTERVAL_MS) {
    return;
  }
  lastStreamErrorReportAt = now;
  vscode.postMessage({ type: 'streamError', message });
}

function setPlayButtonLabel(playing) {
  playbackPlayPause.textContent = playing ? 'Pause' : 'Play';
}

function updateSeekUi(currentTime, duration) {
  playbackDuration.textContent = formatTime(duration);
  if (pendingSeekDrag) {
    return;
  }
  playbackCurrentTime.textContent = formatTime(currentTime);
  if (Number.isFinite(duration) && duration > 0) {
    playbackSeek.value = String(currentTime / duration);
  }
}

function updateDebugPanel() {
  if (!debugContext) {
    debugGrid.innerHTML = renderDebugField('Status', 'No media loaded');
    return;
  }

  const diag = engine.getDiagnostics();

  const fields = [
    renderDebugField('Path', debugContext.debug.fsPath),
    renderDebugField('serverUrl', debugContext.serverUrl),
    renderDebugField('audioId', debugContext.audioId),
    renderDebugField('playbackFormat', debugContext.debug.playbackFormat),
    renderDebugField('chunkBufferCount', String(debugContext.debug.chunkBufferCount)),
    renderDebugField('maxEncodedChunks', String(diag.maxEncodedChunks ?? debugContext.debug.maxEncodedChunks)),
    renderDebugField('encoded chunks', diag.encodedChunkCount != null
      ? diag.encodedChunkCount + ' cached (' + diag.bufferedChunks + ')'
      : diag.bufferedChunks),
    renderDebugField('context', diag.contextState),
    renderDebugField('index.chunkCount', diag.manifestChunkCount != null ? String(diag.manifestChunkCount) : '—'),
    renderDebugField('audio', formatAudioLayout(diag)),
    renderDebugField('currentChunk', String(diag.currentChunkIndex)),
    renderDebugField('ring buffered', diag.ringFramesAvailable != null
      ? `${diag.ringFramesAvailable} frames (${diag.ringFreeFrames} free)`
      : '—'),
    renderDebugField('underrun frames', diag.underrunFrames != null ? String(diag.underrunFrames) : '—'),
    renderDebugField('decoded chunks', diag.decodedChunks),
    renderDebugField('fetch in-flight', diag.fetchInFlight),
    renderDebugField('playheadSec', diag.currentTime.toFixed(2)),
    renderDebugField('durationSec', diag.duration.toFixed(2)),
  ];

  debugGrid.innerHTML = fields.join('');
}

function setControlsEnabled(enabled) {
  playbackPlayPause.disabled = !enabled;
  playbackSeek.disabled = !enabled;
  playbackVolume.disabled = !enabled;
  playbackMuted.disabled = !enabled;
}

async function loadMediaMessage(message) {
  debugContext = message;
  eventLog.length = 0;
  renderEventLog();
  logEvent('loadMedia', message.name);

  trackName.textContent = message.name;
  emptyState.style.display = 'none';
  setControlsEnabled(false);
  setPlayButtonLabel(false);
  playbackSeek.value = '0';
  playbackCurrentTime.textContent = '0:00';
  playbackDuration.textContent = '0:00';
  trackState.textContent = 'Loading index…';
  updateDebugPanel();

  try {
    await engine.load(message.serverUrl, message.audioId, {
      name: message.name,
      chunkBufferCount: message.debug.chunkBufferCount,
      chunkDurationSec: message.debug.chunkDurationSec,
      maxEncodedChunks: message.debug.maxEncodedChunks,
    });
    trackState.textContent = 'Ready';
    setControlsEnabled(true);
    engine.setVolume(Number(playbackVolume.value));
    engine.setMuted(playbackMuted.checked);
    updateDebugPanel();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    trackState.textContent = 'Load error: ' + detail;
    logEvent('error', detail);
    reportStreamError(detail);
    updateDebugPanel();
  }
}

function bindControls() {
  playbackPlayPause.addEventListener('click', () => {
    void (async () => {
      try {
        if (engine.getDiagnostics().paused) {
          trackState.textContent = 'Playing';
          await engine.play();
          setPlayButtonLabel(true);
        } else {
          await engine.pause();
          trackState.textContent = 'Paused';
          setPlayButtonLabel(false);
        }
        updateDebugPanel();
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        trackState.textContent = 'Playback error: ' + detail;
        logEvent('error', detail);
        updateDebugPanel();
      }
    })();
  });

  playbackSeek.addEventListener('pointerdown', () => {
    pendingSeekDrag = true;
  });

  playbackSeek.addEventListener('input', () => {
    pendingSeekDrag = true;
    const duration = engine.getDuration();
    const next = duration * Number(playbackSeek.value);
    playbackCurrentTime.textContent = formatTime(next);
  });

  playbackSeek.addEventListener('change', () => {
    pendingSeekDrag = false;
    const duration = engine.getDuration();
    const next = duration * Number(playbackSeek.value);
    trackState.textContent = 'Seeking…';
    void engine.seek(next).then(() => {
      trackState.textContent = engine.getDiagnostics().paused ? 'Ready' : 'Playing';
      setPlayButtonLabel(!engine.getDiagnostics().paused);
      updateSeekUi(engine.getCurrentTime(), engine.getDuration());
      updateDebugPanel();
    }).catch((error) => {
      const detail = error instanceof Error ? error.message : String(error);
      trackState.textContent = 'Seek error: ' + detail;
      logEvent('error', detail);
      updateDebugPanel();
    });
  });

  playbackSeek.addEventListener('pointercancel', () => {
    pendingSeekDrag = false;
    updateSeekUi(engine.getCurrentTime(), engine.getDuration());
  });

  playbackVolume.addEventListener('input', () => {
    engine.setVolume(Number(playbackVolume.value));
    updateDebugPanel();
  });

  playbackMuted.addEventListener('change', () => {
    engine.setMuted(playbackMuted.checked);
    updateDebugPanel();
  });

  serverRefresh.addEventListener('click', () => {
    vscode.postMessage({ type: 'requestServerStatus' });
  });

  serverRestart.addEventListener('click', () => {
    logEvent('restartServer');
    vscode.postMessage({ type: 'restartServer' });
  });
}

function bindEngineEvents() {
  engine.addEventListener('loading', () => {
    trackState.textContent = 'Loading…';
    updateDebugPanel();
  });

  engine.addEventListener('ready', (event) => {
    updateSeekUi(0, event.detail.duration);
    updateDebugPanel();
  });

  engine.addEventListener('playing', () => {
    setPlayButtonLabel(true);
    trackState.textContent = 'Playing';
    updateDebugPanel();
  });

  engine.addEventListener('pause', () => {
    setPlayButtonLabel(false);
    updateDebugPanel();
  });

  engine.addEventListener('ended', () => {
    setPlayButtonLabel(false);
    trackState.textContent = 'Ended';
    updateDebugPanel();
  });

  engine.addEventListener('timeupdate', (event) => {
    updateSeekUi(event.detail.currentTime, event.detail.duration);
    updateDebugPanel();
  });

  engine.addEventListener('chunkfinished', (event) => {
    const { chunkIndex, bytes } = event.detail;
    let detail = 'chunk=' + chunkIndex;
    if (bytes != null) {
      detail += ' bytes=' + formatChunkBytes(bytes);
    }
    logEvent('fetch', detail);
    updateDebugPanel();
  });

  engine.addEventListener('decodefinished', (event) => {
    const { chunkIndex, elapsedMs, wsolaShiftSamples } = event.detail;
    const ms = elapsedMs.toFixed(1);
    const pct = (elapsedMs / 10).toFixed(1);
    const wsola = formatWsolaShift(wsolaShiftSamples, engine.getDiagnostics().manifestSampleRate);
    logEvent('decode', 'chunk=' + chunkIndex + ' time=' + ms + 'ms(' + pct + '%) wsola=' + wsola);
    updateDebugPanel();
  });

  engine.addEventListener('error', (event) => {
    logEvent('error', event.detail.message);
    if (engine.getDiagnostics().manifestChunkCount == null) {
      trackState.textContent = 'Index error (retrying): ' + event.detail.message;
    }
    reportStreamError(event.detail.message);
    updateDebugPanel();
  });
}

bindControls();
bindEngineEvents();
updateDebugPanel();
updateServerPanel();

window.addEventListener('message', (event) => {
  const message = event.data;
  if (message?.type === 'loadMedia') {
    void loadMediaMessage(message);
    return;
  }
  if (message?.type === 'serverStatus') {
    serverStatus = message.status;
    updateServerPanel();
  }
});

debugPanel.addEventListener('toggle', () => {
  vscode.setState({ debugOpen: debugPanel.open });
});

const savedState = vscode.getState();
if (savedState && 'debugOpen' in savedState) {
  debugPanel.open = Boolean(savedState.debugOpen);
}

vscode.postMessage({ type: 'ready' });
