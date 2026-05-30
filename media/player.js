const vscode = acquireVsCodeApi();
const audioPlayer = document.getElementById('audioPlayer');
const trackName = document.getElementById('trackName');
const trackState = document.getElementById('trackState');
const emptyState = document.getElementById('emptyState');
const debugGrid = document.getElementById('debugGrid');
const debugLog = document.getElementById('debugLog');
const debugPanel = document.getElementById('debugPanel');

let debugContext = null;
let currentSourceKind = 'native';
let fallbackRequested = false;
const eventLog = [];
const MAX_LOG_ENTRIES = 30;

const READY_STATE_LABELS = {
  0: 'HAVE_NOTHING (0)',
  1: 'HAVE_METADATA (1)',
  2: 'HAVE_CURRENT_DATA (2)',
  3: 'HAVE_FUTURE_DATA (3)',
  4: 'HAVE_ENOUGH_DATA (4)',
};

const NETWORK_STATE_LABELS = {
  0: 'NETWORK_EMPTY (0)',
  1: 'NETWORK_IDLE (1)',
  2: 'NETWORK_LOADING (2)',
  3: 'NETWORK_NO_SOURCE (3)',
};

const ERROR_LABELS = {
  1: 'MEDIA_ERR_ABORTED (1)',
  2: 'MEDIA_ERR_NETWORK (2)',
  3: 'MEDIA_ERR_DECODE (3)',
  4: 'MEDIA_ERR_SRC_NOT_SUPPORTED (4)',
};

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) {
    return '—';
  }
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return mins + ':' + String(secs).padStart(2, '0');
}

function formatBuffered(player) {
  const ranges = [];
  for (let index = 0; index < player.buffered.length; index++) {
    ranges.push(formatTime(player.buffered.start(index)) + '–' + formatTime(player.buffered.end(index)));
  }
  return ranges.length ? ranges.join(', ') : '—';
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

function getPlaybackErrorMessage(code) {
  const ffmpegMissing = !debugContext?.debug?.ffmpeg?.available;
  if (ffmpegMissing && (code === 3 || code === 4)) {
    return 'Format not supported — install FFmpeg to enable fallback playback';
  }
  const messages = {
    1: 'Playback aborted',
    2: 'Network error while loading media',
    3: 'Media decode error',
    4: 'Media format not supported',
  };
  return messages[code] ?? 'Playback error';
}

function requestNativeFallback(code) {
  if (fallbackRequested || currentSourceKind !== 'native') {
    return;
  }
  const debug = debugContext?.debug;
  if (
    !debug ||
    debug.unsupportedPlayback !== 'cache' ||
    !debug.unsupportedPlaybackEnabled
  ) {
    return;
  }
  if (code !== 3 && code !== 4) {
    return;
  }
  fallbackRequested = true;
  logEvent('nativePlaybackFailed', 'code=' + code);
  vscode.postMessage({ type: 'nativePlaybackFailed', code });
}

function updateDebugPanel() {
  if (!debugContext) {
    debugGrid.innerHTML = renderDebugField('Status', 'No media loaded');
    return;
  }

  const player = audioPlayer;
  const fields = [
    renderDebugField('File', debugContext.name),
    renderDebugField('Path', debugContext.debug.fsPath),
    renderDebugField('Scheme', debugContext.debug.scheme),
    renderDebugField('Webview URI', debugContext.source),
    renderDebugField('Resource roots', debugContext.debug.resourceRoots.join('\n')),
    renderDebugField('sourceKind', debugContext.debug.sourceKind),
    renderDebugField('cacheFileName', debugContext.debug.cacheFileName),
    renderDebugField('cacheFsPath', debugContext.debug.cacheFsPath),
    renderDebugField('cacheFormat', debugContext.debug.cacheFormat),
    renderDebugField('cacheOggQuality', String(debugContext.debug.cacheOggQuality)),
    renderDebugField('ffmpeg', debugContext.debug.ffmpeg?.available ? 'available' : 'missing'),
    renderDebugField('ffmpeg.path', debugContext.debug.ffmpeg?.path),
    renderDebugField('ffmpeg.version', debugContext.debug.ffmpeg?.version),
    renderDebugField('ffmpeg.error', debugContext.debug.ffmpeg?.error),
    renderDebugField('playback', debugContext.debug.unsupportedPlayback),
    renderDebugField(
      'playback.enabled',
      debugContext.debug.unsupportedPlaybackEnabled ? 'yes' : 'no',
    ),
    renderDebugField('readyState', READY_STATE_LABELS[player.readyState] ?? player.readyState),
    renderDebugField('networkState', NETWORK_STATE_LABELS[player.networkState] ?? player.networkState),
    renderDebugField('currentTime', formatTime(player.currentTime)),
    renderDebugField('duration', formatTime(player.duration)),
    renderDebugField('paused', String(player.paused)),
    renderDebugField('ended', String(player.ended)),
    renderDebugField('seeking', String(player.seeking)),
    renderDebugField('volume', player.volume.toFixed(2)),
    renderDebugField('muted', String(player.muted)),
    renderDebugField('buffered', formatBuffered(player)),
  ];

  if (player.error) {
    fields.push(
      renderDebugField('error.code', ERROR_LABELS[player.error.code] ?? String(player.error.code)),
      renderDebugField('error.message', player.error.message || '—'),
    );
  }

  debugGrid.innerHTML = fields.join('');
}

function bindPlayerEvents(player) {
  const mediaEvents = [
    'loadstart',
    'loadedmetadata',
    'loadeddata',
    'canplay',
    'canplaythrough',
    'play',
    'playing',
    'pause',
    'waiting',
    'seeking',
    'seeked',
    'timeupdate',
    'ended',
    'error',
    'stalled',
    'suspend',
    'abort',
    'emptied',
  ];

  for (const eventName of mediaEvents) {
    player.addEventListener(eventName, () => {
      if (eventName === 'timeupdate') {
        updateDebugPanel();
        return;
      }

      let detail = '';
      if (eventName === 'error' && player.error) {
        detail = ERROR_LABELS[player.error.code] ?? String(player.error.code);
        requestNativeFallback(player.error.code);
      } else if (eventName === 'loadedmetadata') {
        detail = 'duration=' + formatTime(player.duration);
      }

      logEvent(eventName, detail);
      updateDebugPanel();
    });
  }

  player.addEventListener('play', () => {
    trackState.textContent = 'Playing';
  });
  player.addEventListener('pause', () => {
    if (!player.ended) {
      trackState.textContent = 'Paused';
    }
  });
  player.addEventListener('ended', () => {
    trackState.textContent = 'Finished';
  });
  player.addEventListener('error', () => {
    const code = player.error?.code ?? 0;
    if (currentSourceKind === 'cache') {
      trackState.textContent = getPlaybackErrorMessage(code);
    }
  });
}

function loadMediaMessage(message) {
  debugContext = message;
  currentSourceKind = message.debug?.sourceKind ?? 'native';
  fallbackRequested = false;
  eventLog.length = 0;
  renderEventLog();
  logEvent('loadMedia', message.name + ' (' + currentSourceKind + ')');

  trackName.textContent = message.name;
  emptyState.style.display = 'none';
  audioPlayer.src = message.source;
  audioPlayer.load();
  trackState.textContent = 'Loading';
  updateDebugPanel();

  const onCanPlay = () => {
    audioPlayer.removeEventListener('canplay', onCanPlay);
    trackState.textContent = 'Ready';
    updateDebugPanel();
    audioPlayer.play().catch(() => {
      trackState.textContent = 'Ready — press play';
      logEvent('autoplay-blocked');
    });
  };

  audioPlayer.addEventListener('canplay', onCanPlay);
}

bindPlayerEvents(audioPlayer);
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
  if (target === audioPlayer) {
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
  if (!audioPlayer.src || !debugContext) {
    return;
  }

  event.preventDefault();
  if (audioPlayer.paused) {
    audioPlayer.play().catch(() => {
      logEvent('play-blocked');
    });
  } else {
    audioPlayer.pause();
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
