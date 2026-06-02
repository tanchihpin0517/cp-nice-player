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

let debugContext = null;
const eventLog = [];
const MAX_LOG_ENTRIES = 30;
let pendingSeekDrag = false;
const audioEngine = new window.AudioEngine();

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) {
    return '—';
  }
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return mins + ':' + String(secs).padStart(2, '0');
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
    const detail = entry.detail ? ' <span class="event-detail">' + entry.detail + '</span>' : '';
    return '<li>[' + entry.timestamp + '] <span class="event-name">' + entry.name + '</span>' + detail + '</li>';
  }).join('');
}

function renderDebugField(label, value) {
  return '<dt>' + label + '</dt><dd>' + (value ?? '—') + '</dd>';
}

function updateDebugPanel() {
  if (!debugContext) {
    debugGrid.innerHTML = renderDebugField('Status', 'No media loaded');
    return;
  }

  const engine = audioEngine.getDiagnostics();
  const fields = [
    renderDebugField('File', debugContext.name),
    renderDebugField('Path', debugContext.debug.fsPath),
    renderDebugField('Scheme', debugContext.debug.scheme),
    renderDebugField('Playback URL', debugContext.source),
    renderDebugField('Resource roots', debugContext.debug.resourceRoots.join('\n')),
    renderDebugField('transcodedFileName', debugContext.debug.transcodedFileName),
    renderDebugField('transcodedFsPath', debugContext.debug.transcodedFsPath),
    renderDebugField('playbackFormat', debugContext.debug.playbackFormat),
    renderDebugField('playbackOggQuality', String(debugContext.debug.playbackOggQuality)),
    renderDebugField('playbackCodec', debugContext.debug.playbackCodec),
    renderDebugField('contentType', debugContext.debug.contentType),
    renderDebugField('ffmpeg', debugContext.debug.ffmpeg?.available ? 'available' : 'missing'),
    renderDebugField('ffmpeg.path', debugContext.debug.ffmpeg?.path),
    renderDebugField('ffmpeg.version', debugContext.debug.ffmpeg?.version),
    renderDebugField('ffmpeg.error', debugContext.debug.ffmpeg?.error),
    renderDebugField('currentTime', formatTime(engine.currentTime)),
    renderDebugField('duration', formatTime(engine.duration)),
    renderDebugField('paused', String(engine.paused)),
    renderDebugField('ended', String(playbackEnded(engine.duration, engine.currentTime, engine.paused))),
    renderDebugField('volume', Number(engine.volume).toFixed(2)),
    renderDebugField('muted', String(engine.muted)),
    renderDebugField('buffered', 'full file'),
    renderDebugField('webAudio.contextState', engine.contextState),
    renderDebugField('webAudio.sampleRate', String(engine.sampleRate)),
    renderDebugField('webAudio.decoder', engine.decoderType),
  ];

  debugGrid.innerHTML = fields.join('');
}

function playbackEnded(duration, currentTime, paused) {
  if (!Number.isFinite(duration) || duration <= 0) {
    return false;
  }
  return paused && currentTime >= duration - 0.01;
}

function bindPlaybackEvents() {
  audioEngine.addEventListener('loading', () => {
    trackState.textContent = 'Loading playback...';
    logEvent('loading');
    updateDebugPanel();
  });

  audioEngine.addEventListener('ready', (event) => {
    const { duration = 0, decoderType = 'unknown' } = event.detail || {};
    trackState.textContent = 'Ready — press play';
    playbackDuration.textContent = formatTime(duration);
    playbackSeek.value = '0';
    playbackPlayPause.textContent = 'Play';
    logEvent('ready', `decoder=${decoderType}`);
    updateDebugPanel();
  });

  audioEngine.addEventListener('playing', () => {
    playbackPlayPause.textContent = 'Pause';
    trackState.textContent = 'Playing';
    logEvent('playing');
    updateDebugPanel();
  });

  audioEngine.addEventListener('pause', () => {
    playbackPlayPause.textContent = 'Play';
    if (!playbackEnded(audioEngine.getDuration(), audioEngine.getCurrentTime(), true)) {
      trackState.textContent = 'Paused';
    }
    logEvent('pause');
    updateDebugPanel();
  });

  audioEngine.addEventListener('ended', () => {
    playbackPlayPause.textContent = 'Play';
    trackState.textContent = 'Finished';
    logEvent('ended');
    updateDebugPanel();
  });

  audioEngine.addEventListener('timeupdate', (event) => {
    const { currentTime = 0, duration = audioEngine.getDuration() } = event.detail || {};
    playbackCurrentTime.textContent = formatTime(currentTime);
    playbackDuration.textContent = formatTime(duration);
    if (!pendingSeekDrag && Number.isFinite(duration) && duration > 0) {
      playbackSeek.value = String(currentTime / duration);
    }
    updateDebugPanel();
  });

  audioEngine.addEventListener('decoderwarning', (event) => {
    const message = event.detail?.message || 'WebCodecs warning';
    logEvent('decoderwarning', message);
  });
}

function bindPlaybackControls() {
  playbackPlayPause.addEventListener('click', () => {
    if (audioEngine.getDiagnostics().paused) {
      void audioEngine.play();
    } else {
      void audioEngine.pause();
    }
  });

  playbackSeek.addEventListener('input', () => {
    pendingSeekDrag = true;
    const duration = audioEngine.getDuration();
    const next = duration * Number(playbackSeek.value);
    playbackCurrentTime.textContent = formatTime(next);
  });

  playbackSeek.addEventListener('change', () => {
    pendingSeekDrag = false;
    const duration = audioEngine.getDuration();
    const next = duration * Number(playbackSeek.value);
    void audioEngine.seek(next);
  });

  playbackVolume.addEventListener('input', () => {
    audioEngine.setVolume(Number(playbackVolume.value));
    updateDebugPanel();
  });

  playbackMuted.addEventListener('change', () => {
    audioEngine.setMuted(playbackMuted.checked);
    updateDebugPanel();
  });
}

async function startPlayback(message) {
  playbackPlayPause.textContent = 'Play';
  playbackCurrentTime.textContent = '0:00';
  playbackDuration.textContent = '0:00';
  playbackSeek.value = '0';
  playbackVolume.value = '1';
  playbackMuted.checked = false;
  audioEngine.setVolume(1);
  audioEngine.setMuted(false);

  try {
    await audioEngine.load(message.source, {
      codec: message.debug?.playbackCodec || 'unknown',
      name: message.name,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    trackState.textContent = `Playback error: ${detail}`;
    logEvent('error', detail);
    updateDebugPanel();
  }
}

function loadMediaMessage(message) {
  debugContext = message;
  eventLog.length = 0;
  renderEventLog();
  logEvent('loadMedia', message.name);

  trackName.textContent = message.name;
  emptyState.style.display = 'none';
  void startPlayback(message);
}

bindPlaybackEvents();
bindPlaybackControls();
updateDebugPanel();

window.addEventListener('message', (event) => {
  const message = event.data;

  if (message?.type === 'transcodeStatus') {
    if (message.status === 'started') {
      trackState.textContent = 'Transcoding with FFmpeg…';
    } else if (message.status === 'failed') {
      trackState.textContent = message.error || 'Transcode failed';
    }
    logEvent('transcodeStatus', message.status);
    updateDebugPanel();
    return;
  }

  if (message?.type === 'loadMedia') {
    loadMediaMessage(message);
  }
});

function shouldIgnoreSpaceKey(event) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return true;
  }
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) {
    return true;
  }
  if (target.closest('summary')) {
    return true;
  }
  return false;
}

document.addEventListener('keydown', (event) => {
  if (event.code !== 'Space' && event.key !== ' ') {
    return;
  }
  if (event.repeat || shouldIgnoreSpaceKey(event)) {
    return;
  }
  if (!debugContext) {
    return;
  }

  event.preventDefault();
  if (audioEngine.getDiagnostics().paused) {
    void audioEngine.play().catch(() => {
      logEvent('play-blocked');
    });
  } else {
    void audioEngine.pause();
  }
}, true);

debugPanel.addEventListener('toggle', () => {
  vscode.setState({ debugOpen: debugPanel.open });
});

const savedState = vscode.getState();
if (savedState && 'debugOpen' in savedState) {
  debugPanel.open = Boolean(savedState.debugOpen);
}

vscode.postMessage({ type: 'ready' });
