const vscode = acquireVsCodeApi();
const audioPlayer = document.getElementById('audioPlayer');
const trackName = document.getElementById('trackName');
const trackState = document.getElementById('trackState');
const emptyState = document.getElementById('emptyState');
const fallbackControls = document.getElementById('fallbackControls');
const fallbackPlayPause = document.getElementById('fallbackPlayPause');
const fallbackSeek = document.getElementById('fallbackSeek');
const fallbackCurrentTime = document.getElementById('fallbackCurrentTime');
const fallbackDuration = document.getElementById('fallbackDuration');
const fallbackVolume = document.getElementById('fallbackVolume');
const fallbackMuted = document.getElementById('fallbackMuted');
const debugGrid = document.getElementById('debugGrid');
const debugLog = document.getElementById('debugLog');
const debugPanel = document.getElementById('debugPanel');

let debugContext = null;
let currentSourceKind = 'native';
let fallbackRequested = false;
let playbackMode = 'native';
const eventLog = [];
const MAX_LOG_ENTRIES = 30;
let pendingSeekDrag = false;
const audioEngine = new window.AudioEngine();

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

function setPlaybackMode(mode) {
  playbackMode = mode;
  const webAudio = mode === 'webAudio';
  audioPlayer.classList.toggle('is-hidden', webAudio);
  fallbackControls.classList.toggle('is-hidden', !webAudio);
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
  logEvent('requestCachePlayback', 'code=' + code);
  vscode.postMessage({ type: 'requestCachePlayback', code });
}

function updateDebugPanel() {
  if (!debugContext) {
    debugGrid.innerHTML = renderDebugField('Status', 'No media loaded');
    return;
  }

  const player = audioPlayer;
  const engine = audioEngine.getDiagnostics();
  const currentTime = playbackMode === 'webAudio' ? engine.currentTime : player.currentTime;
  const duration = playbackMode === 'webAudio' ? engine.duration : player.duration;
  const paused = playbackMode === 'webAudio' ? engine.paused : player.paused;
  const muted = playbackMode === 'webAudio' ? engine.muted : player.muted;
  const volume = playbackMode === 'webAudio' ? engine.volume : player.volume;
  const fields = [
    renderDebugField('File', debugContext.name),
    renderDebugField('Path', debugContext.debug.fsPath),
    renderDebugField('Scheme', debugContext.debug.scheme),
    renderDebugField('Playback URI', debugContext.source),
    renderDebugField('Resource roots', debugContext.debug.resourceRoots.join('\n')),
    renderDebugField('sourceKind', debugContext.debug.sourceKind),
    renderDebugField('cacheFileName', debugContext.debug.cacheFileName),
    renderDebugField('cacheFsPath', debugContext.debug.cacheFsPath),
    renderDebugField('cacheFormat', debugContext.debug.cacheFormat),
    renderDebugField('cacheOggQuality', String(debugContext.debug.cacheOggQuality)),
    renderDebugField('playbackMode', playbackMode),
    renderDebugField('playbackCodec', debugContext.debug.playbackCodec),
    renderDebugField('contentType', debugContext.debug.contentType),
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
    renderDebugField('currentTime', formatTime(currentTime)),
    renderDebugField('duration', formatTime(duration)),
    renderDebugField('paused', String(paused)),
    renderDebugField('ended', String(playerbackEnded(duration, currentTime, paused))),
    renderDebugField('seeking', String(player.seeking)),
    renderDebugField('volume', Number(volume).toFixed(2)),
    renderDebugField('muted', String(muted)),
    renderDebugField('buffered', playbackMode === 'webAudio' ? 'full file' : formatBuffered(player)),
    renderDebugField('webAudio.contextState', engine.contextState),
    renderDebugField('webAudio.sampleRate', String(engine.sampleRate)),
    renderDebugField('webAudio.decoder', engine.decoderType),
  ];

  if (player.error) {
    fields.push(
      renderDebugField('error.code', ERROR_LABELS[player.error.code] ?? String(player.error.code)),
      renderDebugField('error.message', player.error.message || '—'),
    );
  }

  debugGrid.innerHTML = fields.join('');
}

function playerbackEnded(duration, currentTime, paused) {
  if (!Number.isFinite(duration) || duration <= 0) {
    return false;
  }
  return paused && currentTime >= duration - 0.01;
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
    if (playbackMode !== 'native') {
      return;
    }
    const code = player.error?.code ?? 0;
    if (currentSourceKind === 'cache') {
      trackState.textContent = getPlaybackErrorMessage(code);
    }
  });
}

function bindFallbackEvents() {
  audioEngine.addEventListener('loading', () => {
    trackState.textContent = 'Loading fallback playback...';
    logEvent('fallback-loading');
    updateDebugPanel();
  });

  audioEngine.addEventListener('ready', (event) => {
    const { duration = 0, decoderType = 'unknown' } = event.detail || {};
    trackState.textContent = 'Ready — press play';
    fallbackDuration.textContent = formatTime(duration);
    fallbackSeek.value = '0';
    fallbackPlayPause.textContent = 'Play';
    logEvent('fallback-ready', `decoder=${decoderType}`);
    updateDebugPanel();
  });

  audioEngine.addEventListener('playing', () => {
    fallbackPlayPause.textContent = 'Pause';
    trackState.textContent = 'Playing (Web Audio fallback)';
    logEvent('fallback-playing');
    updateDebugPanel();
  });

  audioEngine.addEventListener('pause', () => {
    fallbackPlayPause.textContent = 'Play';
    if (!playerbackEnded(audioEngine.getDuration(), audioEngine.getCurrentTime(), true)) {
      trackState.textContent = 'Paused (Web Audio fallback)';
    }
    logEvent('fallback-pause');
    updateDebugPanel();
  });

  audioEngine.addEventListener('ended', () => {
    fallbackPlayPause.textContent = 'Play';
    trackState.textContent = 'Finished';
    logEvent('fallback-ended');
    updateDebugPanel();
  });

  audioEngine.addEventListener('timeupdate', (event) => {
    const { currentTime = 0, duration = audioEngine.getDuration() } = event.detail || {};
    fallbackCurrentTime.textContent = formatTime(currentTime);
    fallbackDuration.textContent = formatTime(duration);
    if (!pendingSeekDrag && Number.isFinite(duration) && duration > 0) {
      fallbackSeek.value = String(currentTime / duration);
    }
    updateDebugPanel();
  });

  audioEngine.addEventListener('decoderwarning', (event) => {
    const message = event.detail?.message || 'WebCodecs warning';
    logEvent('decoderwarning', message);
  });
}

function bindFallbackControls() {
  fallbackPlayPause.addEventListener('click', () => {
    if (audioEngine.getDiagnostics().paused) {
      void audioEngine.play();
    } else {
      void audioEngine.pause();
    }
  });

  fallbackSeek.addEventListener('input', () => {
    pendingSeekDrag = true;
    const duration = audioEngine.getDuration();
    const next = duration * Number(fallbackSeek.value);
    fallbackCurrentTime.textContent = formatTime(next);
  });

  fallbackSeek.addEventListener('change', () => {
    pendingSeekDrag = false;
    const duration = audioEngine.getDuration();
    const next = duration * Number(fallbackSeek.value);
    void audioEngine.seek(next);
  });

  fallbackVolume.addEventListener('input', () => {
    audioEngine.setVolume(Number(fallbackVolume.value));
    updateDebugPanel();
  });

  fallbackMuted.addEventListener('change', () => {
    audioEngine.setMuted(fallbackMuted.checked);
    updateDebugPanel();
  });
}

async function startWebAudioFallback(message) {
  setPlaybackMode('webAudio');
  audioPlayer.pause();
  audioPlayer.removeAttribute('src');
  audioPlayer.load();
  fallbackPlayPause.textContent = 'Play';
  fallbackCurrentTime.textContent = '0:00';
  fallbackDuration.textContent = '0:00';
  fallbackSeek.value = '0';
  fallbackVolume.value = '1';
  fallbackMuted.checked = false;
  audioEngine.setVolume(1);
  audioEngine.setMuted(false);

  try {
    await audioEngine.load(message.source, {
      codec: message.debug?.playbackCodec || 'unknown',
      name: message.name,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    trackState.textContent = `Fallback error: ${detail}`;
    logEvent('fallback-error', detail);
    requestNativeFallback(3);
    updateDebugPanel();
  }
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
  if (currentSourceKind === 'cache') {
    void startWebAudioFallback(message);
    return;
  }

  setPlaybackMode('native');
  void audioEngine.stop();
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
bindFallbackEvents();
bindFallbackControls();
setPlaybackMode('native');
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
  if (!debugContext) {
    return;
  }

  event.preventDefault();
  if (playbackMode === 'webAudio') {
    if (audioEngine.getDiagnostics().paused) {
      void audioEngine.play().catch(() => {
        logEvent('play-blocked');
      });
    } else {
      void audioEngine.pause();
    }
    return;
  }

  if (audioPlayer.paused) {
    audioPlayer.play().catch(() => {
      logEvent('play-blocked');
    });
  } else {
    audioPlayer.pause();
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
