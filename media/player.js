const vscode = acquireVsCodeApi();
const audioPlayer = document.getElementById('audioPlayer');
const videoPlayer = document.getElementById('videoPlayer');
const trackName = document.getElementById('trackName');
const trackState = document.getElementById('trackState');
const emptyState = document.getElementById('emptyState');
const debugGrid = document.getElementById('debugGrid');
const debugLog = document.getElementById('debugLog');
const debugPanel = document.getElementById('debugPanel');

let activePlayer = null;
let debugContext = null;
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

function updateDebugPanel() {
  if (!debugContext) {
    debugGrid.innerHTML = renderDebugField('Status', 'No media loaded');
    return;
  }

  const player = activePlayer;
  const fields = [
    renderDebugField('File', debugContext.name),
    renderDebugField('Path', debugContext.debug.fsPath),
    renderDebugField('Scheme', debugContext.debug.scheme),
    renderDebugField('Media type', debugContext.mediaType),
    renderDebugField('Webview URI', debugContext.source),
    renderDebugField('Resource roots', debugContext.debug.resourceRoots.join('\n')),
    renderDebugField('ffmpeg', debugContext.debug.ffmpeg?.available ? 'available' : 'missing'),
    renderDebugField('ffmpeg.path', debugContext.debug.ffmpeg?.path),
    renderDebugField('ffmpeg.version', debugContext.debug.ffmpeg?.version),
    renderDebugField('Active element', player?.tagName.toLowerCase() ?? '—'),
    renderDebugField('readyState', player ? READY_STATE_LABELS[player.readyState] ?? player.readyState : '—'),
    renderDebugField('networkState', player ? NETWORK_STATE_LABELS[player.networkState] ?? player.networkState : '—'),
    renderDebugField('currentTime', player ? formatTime(player.currentTime) : '—'),
    renderDebugField('duration', player ? formatTime(player.duration) : '—'),
    renderDebugField('paused', player ? String(player.paused) : '—'),
    renderDebugField('ended', player ? String(player.ended) : '—'),
    renderDebugField('seeking', player ? String(player.seeking) : '—'),
    renderDebugField('volume', player ? player.volume.toFixed(2) : '—'),
    renderDebugField('muted', player ? String(player.muted) : '—'),
    renderDebugField('buffered', player ? formatBuffered(player) : '—'),
  ];

  if (player?.tagName === 'VIDEO') {
    fields.push(
      renderDebugField('videoWidth', String(player.videoWidth || '—')),
      renderDebugField('videoHeight', String(player.videoHeight || '—')),
    );
  }

  if (player?.error) {
    fields.push(
      renderDebugField('error.code', ERROR_LABELS[player.error.code] ?? String(player.error.code)),
      renderDebugField('error.message', player.error.message || '—'),
    );
  }

  debugGrid.innerHTML = fields.join('');
}

function setActivePlayer(player) {
  if (activePlayer && activePlayer !== player) {
    activePlayer.pause();
    activePlayer.removeAttribute('src');
    activePlayer.classList.remove('active');
  }
  activePlayer = player;
  player.classList.add('active');
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
    const messages = {
      1: 'Playback aborted',
      2: 'Network error while loading media',
      3: 'Media decode error',
      4: 'Media format not supported',
    };
    trackState.textContent = messages[code] ?? 'Playback error';
  });
}

bindPlayerEvents(audioPlayer);
bindPlayerEvents(videoPlayer);
updateDebugPanel();

window.addEventListener('message', (event) => {
  const message = event.data;
  if (message?.type !== 'loadMedia') {
    return;
  }

  debugContext = message;
  eventLog.length = 0;
  renderEventLog();
  logEvent('loadMedia', message.mediaType + ' · ' + message.name);

  const player = message.mediaType === 'video' ? videoPlayer : audioPlayer;
  setActivePlayer(player);

  trackName.textContent = message.name;
  emptyState.style.display = 'none';
  player.src = message.source;
  player.load();
  trackState.textContent = 'Loading';
  updateDebugPanel();

  const onCanPlay = () => {
    player.removeEventListener('canplay', onCanPlay);
    trackState.textContent = 'Ready';
    updateDebugPanel();
    player.play().catch(() => {
      trackState.textContent = 'Ready — press play';
      logEvent('autoplay-blocked');
    });
  };

  player.addEventListener('canplay', onCanPlay);
});

debugPanel.addEventListener('toggle', () => {
  vscode.setState({ debugOpen: debugPanel.open });
});

const savedState = vscode.getState();
if (savedState && 'debugOpen' in savedState) {
  debugPanel.open = Boolean(savedState.debugOpen);
}

vscode.postMessage({ type: 'ready' });
