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

const engine = new StreamingAudioEngine();
let debugContext = null;
let pendingSeekDrag = false;
const eventLog = [];
const MAX_LOG_ENTRIES = 30;

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) {
    return '—';
  }
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return mins + ':' + String(secs).padStart(2, '0');
}

function formatChunkBytes(bytes) {
  if (bytes < 1024) {
    return bytes + 'B';
  }
  if (bytes < 1024 * 1024) {
    return (bytes / 1024).toFixed(1) + 'KB';
  }
  return (bytes / (1024 * 1024)).toFixed(1) + 'MB';
}

function formatAudioLayout(diag) {
  const channels = diag.manifestChannels;
  const manifestRate = diag.manifestSampleRate;
  const contextRate = diag.contextSampleRate;
  if (!channels || !manifestRate) {
    return '—';
  }
  let layout = channels + 'ch @ ' + manifestRate + ' Hz';
  if (contextRate && contextRate !== manifestRate) {
    layout += ' (ctx ' + contextRate + ' Hz)';
  }
  return layout;
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

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

function renderDebugField(label, value) {
  return '<dt>' + escapeHtml(label) + '</dt><dd>' + escapeHtml(value ?? '—') + '</dd>';
}

function setPlayButtonLabel(playing) {
  playbackPlayPause.textContent = playing ? 'Pause' : 'Play';
}

function updateSeekUi(currentTime, duration) {
  playbackDuration.textContent = formatTime(duration);
  playbackCurrentTime.textContent = formatTime(currentTime);
  if (!pendingSeekDrag && Number.isFinite(duration) && duration > 0) {
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
    renderDebugField('context', diag.contextState),
    renderDebugField('index.chunkCount', diag.manifestChunkCount != null ? String(diag.manifestChunkCount) : '—'),
    renderDebugField('audio', formatAudioLayout(diag)),
    renderDebugField('currentChunk', String(diag.currentChunkIndex)),
    renderDebugField('buffered chunks', diag.bufferedChunks),
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
      updateDebugPanel();
    }).catch((error) => {
      const detail = error instanceof Error ? error.message : String(error);
      trackState.textContent = 'Seek error: ' + detail;
      logEvent('error', detail);
      updateDebugPanel();
    });
  });

  playbackVolume.addEventListener('input', () => {
    engine.setVolume(Number(playbackVolume.value));
    updateDebugPanel();
  });

  playbackMuted.addEventListener('change', () => {
    engine.setMuted(playbackMuted.checked);
    updateDebugPanel();
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

  engine.addEventListener('streamstatus', (event) => {
    const { phase, status, chunkIndex, bytes, elapsedMs } = event.detail;
    if (phase === 'decode' && status === 'finished') {
      const ms = elapsedMs.toFixed(1);
      const pct = (elapsedMs / 10).toFixed(1);
      logEvent(phase, 'chunk=' + chunkIndex + ' time=' + ms + 'ms(' + pct + '%)');
    } else if (phase === 'chunk' && status === 'finished') {
      let fetchDetail = 'chunk=' + chunkIndex;
      if (bytes != null) {
        fetchDetail += ' bytes=' + formatChunkBytes(bytes);
      }
      logEvent('fetch', fetchDetail);
    }
    updateDebugPanel();
  });

  engine.addEventListener('error', (event) => {
    logEvent('error', event.detail.message);
    if (engine.getDiagnostics().manifestChunkCount == null) {
      trackState.textContent = 'Index error (retrying): ' + event.detail.message;
    }
    updateDebugPanel();
  });
}

bindControls();
bindEngineEvents();
updateDebugPanel();

window.addEventListener('message', (event) => {
  const message = event.data;
  if (message?.type === 'loadMedia') {
    void loadMediaMessage(message);
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
