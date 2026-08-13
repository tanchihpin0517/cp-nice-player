/*
 * View layer for the player. Owns the DOM and nothing else: it talks to an
 * object with the StreamingAudioEngine interface (load/play/pause/seek/
 * setVolume/setMuted/getDiagnostics + events), so the same file drives the real
 * engine in the webview and the mock engine in the standalone demo.
 *
 * Depends on globals from formatUtils.js and waveform.js.
 */

const SKIP_SECONDS = 10;
const MAX_LOG_ENTRIES = 60;
/** Marks a bucket the engine has not decoded yet, as opposed to a silent one. */
const UNMEASURED = -1;

/** "0-3, 7" -> [[0,3],[7,7]]. Today's engine reports ranges as a string. */
function parseChunkRanges(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value !== 'string' || value === '' || value === '—' || value === 'none') {
    return [];
  }
  const ranges = [];
  for (const part of value.split(',')) {
    const text = part.trim();
    if (!text) {
      continue;
    }
    const [start, end] = text.split('-');
    const from = Number(start);
    const to = end === undefined ? from : Number(end);
    if (Number.isFinite(from) && Number.isFinite(to)) {
      ranges.push([from, to]);
    }
  }
  return ranges;
}

class PlayerView {
  constructor(root, engine, hooks = {}) {
    this.root = root;
    this.engine = engine;
    this.hooks = hooks;
    this.context = null;
    this.serverStatus = null;
    this.peaks = null;
    this.peaksPerChunk = 0;
    this.chunkCount = 0;
    this.eventLog = [];
    this.scrubbing = false;
    this.el = {};

    const id = (name) => root.querySelector('#' + name);
    this.el = {
      name: id('trackName'),
      chipFormat: id('chipFormat'),
      chipLayout: id('chipLayout'),
      chipChunks: id('chipChunks'),
      status: id('trackStatus'),
      statusText: id('trackStatusText'),
      wave: id('wave'),
      waveCanvas: id('waveCanvas'),
      waveHover: id('waveHover'),
      waveHoverTime: id('waveHoverTime'),
      currentTime: id('currentTime'),
      durationTime: id('durationTime'),
      playPause: id('playPause'),
      skipBack: id('skipBack'),
      skipForward: id('skipForward'),
      muteBtn: id('muteBtn'),
      volume: id('volume'),
      inspector: id('inspector'),
      inspectorToggle: id('inspectorToggle'),
      errorMessage: id('errorMessage'),
      errorRetry: id('errorRetry'),
      errorDiagnostics: id('errorDiagnostics'),
      serverGrid: id('serverGrid'),
      playbackGrid: id('playbackGrid'),
      log: id('eventLog'),
      serverRefresh: id('serverRefresh'),
      serverRestart: id('serverRestart'),
    };

    this.waveform = new WaveformView(this.el.waveCanvas);
    this._buildSkeleton(root.querySelector('#waveSkeleton'));

    this._bindControls();
    this._bindWaveform();
    this._bindEngine();
    this._bindKeyboard();

    this.setState('empty');
    this.setControlsEnabled(false);
    this._renderVolume();
    this.renderServerPanel();
    this.renderPlaybackPanel();
  }

  /** Placeholder bars shown while the index is being fetched. */
  _buildSkeleton(container) {
    if (!container) {
      return;
    }
    const bars = 36;
    for (let i = 0; i < bars; i += 1) {
      const bar = document.createElement('span');
      bar.className = 'cp-skeleton-bar';
      bar.style.animationDelay = (i * 45) + 'ms';
      container.appendChild(bar);
    }
  }

  // --------------------------------------------------------------- state

  setState(state) {
    this.root.dataset.state = state;
  }

  /** Fatal-for-now state: the card carries the full message, the pill a summary. */
  setError(message) {
    this.setState('error');
    this.setStatus(message, 'error');
    this.setControlsEnabled(false);
    if (this.el.errorMessage) {
      this.el.errorMessage.textContent = message;
    }
  }

  setStatus(text, tone) {
    this.el.statusText.textContent = text;
    this.el.status.dataset.tone = tone || 'idle';
  }

  setControlsEnabled(enabled) {
    for (const key of ['playPause', 'skipBack', 'skipForward', 'muteBtn', 'volume']) {
      this.el[key].disabled = !enabled;
    }
    this.el.wave.setAttribute('aria-disabled', String(!enabled));
  }

  refreshTheme() {
    this.waveform.refreshTheme();
    this._renderVolume();
  }

  // ---------------------------------------------------------------- load

  async loadMedia(message) {
    this.context = message;
    this.eventLog = [];
    this.renderLog();
    this.logEvent('loadMedia', message.name);

    this.el.name.textContent = message.name;
    this.el.chipFormat.textContent = message.debug.playbackFormat
      ? message.debug.playbackFormat.toUpperCase()
      : '';
    this.el.chipLayout.textContent = '';
    this.el.chipChunks.textContent = '';
    this.el.currentTime.textContent = '0:00';
    this.el.durationTime.textContent = '0:00';

    this.setState('loading');
    this.setStatus('Loading index…', 'busy');
    this.setControlsEnabled(false);
    this._resetPeaks(0);
    this.waveform.setProgress(0);
    this.waveform.setBuffer({ chunkCount: 0, decoded: [], inflight: [] });

    try {
      await this.engine.load(message.serverUrl, message.audioId, {
        name: message.name,
        chunkBufferCount: message.debug.chunkBufferCount,
        chunkDurationSec: message.debug.chunkDurationSec,
        maxEncodedChunks: message.debug.maxEncodedChunks,
      });
      this.setState('ready');
      this.setStatus('Ready', 'live');
      this.setControlsEnabled(true);
      this.engine.setVolume(Number(this.el.volume.value));
      this.engine.setMuted(this.root.dataset.muted === 'true');
      this.sync();
    } catch (error) {
      this.setError(errorText(error));
      this.logEvent('error', errorText(error), 'error');
      this.hooks.onStreamError?.(errorText(error));
      this.sync();
    }
  }

  // ------------------------------------------------------------- controls

  _bindControls() {
    this.el.playPause.addEventListener('click', () => void this.togglePlay());
    this.el.skipBack.addEventListener('click', () => void this.skip(-SKIP_SECONDS));
    this.el.skipForward.addEventListener('click', () => void this.skip(SKIP_SECONDS));

    this.el.muteBtn.addEventListener('click', () => {
      const muted = this.root.dataset.muted !== 'true';
      this.root.dataset.muted = String(muted);
      this.engine.setMuted(muted);
      this.el.muteBtn.setAttribute('aria-label', muted ? 'Unmute' : 'Mute');
    });

    this.el.volume.addEventListener('input', () => {
      this.engine.setVolume(Number(this.el.volume.value));
      if (this.root.dataset.muted === 'true') {
        this.root.dataset.muted = 'false';
        this.engine.setMuted(false);
      }
      this._renderVolume();
    });

    this.el.inspectorToggle.addEventListener('click', () => {
      const open = this.el.inspector.hidden;
      this.setInspectorOpen(open);
      this.hooks.onInspectorToggle?.(open);
    });

    this.el.errorRetry?.addEventListener('click', () => this.hooks.onRetry?.());
    this.el.errorDiagnostics?.addEventListener('click', () => {
      this.setInspectorOpen(true);
      this.el.inspector.scrollIntoView({ block: 'nearest' });
    });

    this.el.serverRefresh?.addEventListener('click', () => this.hooks.onServerRefresh?.());
    this.el.serverRestart?.addEventListener('click', () => {
      this.logEvent('restartServer', '');
      this.hooks.onServerRestart?.();
    });
  }

  setInspectorOpen(open) {
    this.el.inspector.hidden = !open;
    this.el.inspectorToggle.setAttribute('aria-expanded', String(open));
  }

  async togglePlay() {
    try {
      if (this.engine.getDiagnostics().paused) {
        await this.engine.play();
      } else {
        await this.engine.pause();
      }
    } catch (error) {
      this.setStatus('Playback error: ' + errorText(error), 'error');
      this.logEvent('error', errorText(error), 'error');
    }
    this.sync();
  }

  async skip(delta) {
    const next = clamp(this.engine.getCurrentTime() + delta, 0, this.engine.getDuration());
    await this.seekTo(next);
  }

  async seekTo(seconds) {
    const wasPlaying = !this.engine.getDiagnostics().paused;
    this.setStatus('Seeking…', 'busy');
    try {
      await this.engine.seek(seconds);
      this.setStatus(wasPlaying ? 'Playing' : 'Ready', wasPlaying ? 'live' : 'idle');
    } catch (error) {
      this.setStatus('Seek failed: ' + errorText(error), 'error');
      this.logEvent('error', errorText(error), 'error');
    }
    this.sync();
  }

  // ------------------------------------------------------------- waveform

  _bindWaveform() {
    const { wave } = this.el;

    const timeAt = (event) => {
      const rect = wave.getBoundingClientRect();
      return this.waveform.timeAtX(event.clientX - rect.left);
    };

    wave.addEventListener('pointermove', (event) => {
      if (wave.getAttribute('aria-disabled') === 'true') {
        return;
      }
      const time = timeAt(event);
      const rect = wave.getBoundingClientRect();
      const x = clamp(event.clientX - rect.left, 34, rect.width - 34);
      this.el.waveHover.style.left = x + 'px';
      this.el.waveHoverTime.textContent = formatTime(time);
      this.waveform.setHoverTime(time);
      if (this.scrubbing) {
        this.el.currentTime.textContent = formatTime(time);
        this.waveform.setProgress(time);
      }
    });

    wave.addEventListener('pointerleave', () => {
      this.waveform.setHoverTime(null);
      if (!this.scrubbing) {
        this.waveform.setProgress(this.engine.getCurrentTime());
      }
    });

    wave.addEventListener('pointerdown', (event) => {
      if (wave.getAttribute('aria-disabled') === 'true') {
        return;
      }
      this.scrubbing = true;
      wave.dataset.scrubbing = 'true';
      wave.setPointerCapture(event.pointerId);
      const time = timeAt(event);
      this.waveform.setProgress(time);
      this.el.currentTime.textContent = formatTime(time);
    });

    wave.addEventListener('pointerup', (event) => {
      if (!this.scrubbing) {
        return;
      }
      this.scrubbing = false;
      wave.dataset.scrubbing = 'false';
      void this.seekTo(timeAt(event));
    });

    wave.addEventListener('keydown', (event) => {
      const step = event.shiftKey ? 30 : 5;
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        void this.skip(step);
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        void this.skip(-step);
      } else if (event.key === 'Home') {
        event.preventDefault();
        void this.seekTo(0);
      } else if (event.key === 'End') {
        event.preventDefault();
        void this.seekTo(this.engine.getDuration());
      }
    });
  }

  _bindKeyboard() {
    this.root.ownerDocument.addEventListener('keydown', (event) => {
      const target = event.target;
      const typing = target instanceof HTMLElement
        && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.isContentEditable);
      if (typing || this.el.playPause.disabled) {
        return;
      }
      if (event.key === ' ' || event.key === 'k') {
        event.preventDefault();
        void this.togglePlay();
      } else if (event.key === 'm') {
        this.el.muteBtn.click();
      } else if (event.key === 'j') {
        void this.skip(-SKIP_SECONDS);
      } else if (event.key === 'l') {
        void this.skip(SKIP_SECONDS);
      }
    });
  }

  // --------------------------------------------------------------- engine

  _bindEngine() {
    const on = (name, handler) => this.engine.addEventListener(name, handler);

    on('loading', () => {
      this.setState('loading');
      this.setStatus('Loading…', 'busy');
      this.sync();
    });

    on('ready', (event) => {
      this.waveform.setDuration(event.detail.duration);
      this.el.durationTime.textContent = formatTime(event.detail.duration);
      this._resetPeaks(this.engine.getDiagnostics().manifestChunkCount);
      this.sync();
    });

    on('playing', () => {
      this.root.dataset.playing = 'true';
      this.el.playPause.setAttribute('aria-label', 'Pause');
      this.setStatus('Playing', 'live');
      this.sync();
    });

    on('pause', () => {
      this.root.dataset.playing = 'false';
      this.el.playPause.setAttribute('aria-label', 'Play');
      this.setStatus('Paused', 'idle');
      this.sync();
    });

    on('ended', () => {
      this.root.dataset.playing = 'false';
      this.setStatus('Ended', 'idle');
      this.sync();
    });

    on('timeupdate', (event) => {
      if (!this.scrubbing) {
        this.el.currentTime.textContent = formatTime(event.detail.currentTime);
        this.waveform.setProgress(event.detail.currentTime);
      }
      this.sync();
    });

    on('chunkfinished', (event) => {
      const { chunkIndex, bytes } = event.detail;
      this.logEvent('fetch', 'chunk=' + chunkIndex + (bytes != null ? ' bytes=' + formatChunkBytes(bytes) : ''));
      this.sync();
    });

    on('decodefinished', (event) => {
      const { chunkIndex, elapsedMs, wsolaShiftSamples, peaks } = event.detail;
      const rate = this.engine.getDiagnostics().manifestSampleRate;
      this.recordChunkPeaks(chunkIndex, peaks);
      this.logEvent('decode', 'chunk=' + chunkIndex
        + ' time=' + elapsedMs.toFixed(1) + 'ms'
        + ' wsola=' + formatWsolaShift(wsolaShiftSamples, rate));
      this.sync();
    });

    on('error', (event) => {
      const message = event.detail.message;
      this.logEvent('error', message, 'error');
      // A chunk that fails mid-track is recoverable and stays in the log; only a
      // missing index means there is nothing to play at all.
      if (this.engine.getDiagnostics().manifestChunkCount == null) {
        this.setError(message);
      }
      this.hooks.onStreamError?.(message);
      this.sync();
    });
  }

  /**
   * The waveform is built from playback itself: the engine hands over an envelope
   * for every chunk it decodes, and those are kept for the whole session even
   * after the decoded audio is evicted. So the overview fills in as you listen or
   * seek around, and regions never reached stay ghosted rather than being fetched
   * a second time just to be drawn.
   */
  _resetPeaks(chunkCount) {
    this.chunkCount = chunkCount || 0;
    this.peaks = null;
    this.waveform.setPeaks(null);
  }

  /**
   * Allocated on the first chunk rather than up front, so the buckets-per-chunk
   * resolution is whatever the engine actually sends. Nothing here has to agree
   * with a constant declared somewhere else.
   */
  recordChunkPeaks(chunkIndex, peaks) {
    if (!peaks || !peaks.length || !Number.isInteger(chunkIndex) || !this.chunkCount) {
      return;
    }

    if (!this.peaks) {
      this.peaksPerChunk = peaks.length;
      this.peaks = new Float32Array(this.chunkCount * this.peaksPerChunk).fill(UNMEASURED);
    }

    const offset = chunkIndex * this.peaksPerChunk;
    if (offset < 0 || offset + peaks.length > this.peaks.length) {
      return;
    }
    this.peaks.set(peaks, offset);
    // Same buffer the waveform already holds; this just triggers a repaint.
    this.waveform.setPeaks(this.peaks);
  }

  /** Pull one snapshot of engine state into every part of the UI that shows it. */
  sync() {
    const diag = this.engine.getDiagnostics();

    this.waveform.setBuffer({
      chunkCount: diag.manifestChunkCount ?? 0,
      decoded: parseChunkRanges(diag.decodedChunkList ?? diag.decodedChunks),
      inflight: parseChunkRanges(diag.fetchInFlightList ?? diag.fetchInFlight),
    });

    if (diag.duration) {
      this.waveform.setDuration(diag.duration);
      this.el.durationTime.textContent = formatTime(diag.duration);
    }

    const layout = formatAudioLayout(diag);
    this.el.chipLayout.textContent = layout === '—' ? '' : layout;
    this.el.chipChunks.textContent = diag.manifestChunkCount
      ? diag.manifestChunkCount + ' chunks · ' + (this.context?.debug.chunkDurationSec ?? 1) + 's'
      : '';

    this.renderPlaybackPanel(diag);
  }

  _renderVolume() {
    this.el.volume.style.setProperty('--cp-range-fill', Number(this.el.volume.value) * 100 + '%');
  }

  // ---------------------------------------------------------- diagnostics

  logEvent(name, detail, kind) {
    this.eventLog.unshift({
      time: new Date().toLocaleTimeString(),
      name,
      detail: detail || '',
      kind: kind || 'info',
    });
    if (this.eventLog.length > MAX_LOG_ENTRIES) {
      this.eventLog.length = MAX_LOG_ENTRIES;
    }
    this.renderLog();
  }

  renderLog() {
    this.el.log.innerHTML = this.eventLog.map((entry) => ''
      + '<li data-kind="' + entry.kind + '">'
      + '<span class="cp-log-time">' + escapeHtml(entry.time) + '</span>'
      + '<span class="cp-log-name">' + escapeHtml(entry.name) + '</span>'
      + '<span class="cp-log-detail">' + escapeHtml(entry.detail) + '</span>'
      + '</li>').join('');
  }

  setServerStatus(status) {
    this.serverStatus = status;
    this.renderServerPanel();
  }

  renderServerPanel() {
    const status = this.serverStatus;
    if (!status) {
      this.el.serverGrid.innerHTML = field('state', 'unknown (no report from extension)', 'bad');
      return;
    }

    const rows = [field('state', status.state, status.state === 'listening' ? 'ok' : 'bad')];
    if (status.externalUrl) {
      rows.push(field('url', status.externalUrl));
    }
    if (status.urlForwarded && status.localUrl) {
      rows.push(field('local url', status.localUrl + ' (forwarded)'));
    }
    rows.push(field(
      'host reachable',
      formatHostReachable(status.hostReachable),
      status.hostReachable ? (status.hostReachable.ok ? 'ok' : 'bad') : undefined,
    ));
    rows.push(field('registered audio', String(status.registeredAudioCount ?? 0)));
    rows.push(field(
      'ffmpeg',
      formatFfmpegStatus(status.ffmpeg),
      status.ffmpeg && !status.ffmpeg.available ? 'bad' : undefined,
    ));
    if (status.lastError) {
      rows.push(field('last error', status.lastError, 'bad'));
    }

    this.el.serverGrid.innerHTML = rows.join('');
  }

  renderPlaybackPanel(diag) {
    if (!this.context) {
      this.el.playbackGrid.innerHTML = field('status', 'no media loaded');
      return;
    }
    const d = diag || this.engine.getDiagnostics();
    const underrun = d.underrunFrames > 0;

    this.el.playbackGrid.innerHTML = [
      field('path', this.context.debug.fsPath),
      field('audioId', this.context.audioId),
      field('format', d.contextState === 'uninitialized' ? '—' : this.context.debug.playbackFormat),
      field('audio', formatAudioLayout(d)),
      field('context', d.contextState, d.contextState === 'running' ? 'ok' : undefined),
      field('index.chunkCount', d.manifestChunkCount != null ? String(d.manifestChunkCount) : '—'),
      field('currentChunk', String(d.currentChunkIndex)),
      field('decoded chunks', d.decodedChunks || '—'),
      field('fetch in-flight', d.fetchInFlight || 'idle'),
      field('encoded cache', (d.encodedChunkCount ?? 0) + ' / ' + (d.maxEncodedChunks ?? '—')),
      field('ring buffered', d.ringFramesAvailable != null
        ? d.ringFramesAvailable + ' frames (' + d.ringFreeFrames + ' free)'
        : '—'),
      field('underrun frames', String(d.underrunFrames ?? 0), underrun ? 'warn' : 'ok'),
      field('playhead', d.currentTime.toFixed(2) + 's / ' + d.duration.toFixed(2) + 's'),
    ].join('');
  }
}

function field(label, value, tone) {
  const cls = tone ? ' class="' + tone + '"' : '';
  return '<dt>' + escapeHtml(label) + '</dt><dd' + cls + '>' + escapeHtml(value ?? '—') + '</dd>';
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

function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

if (typeof window !== 'undefined') {
  window.PlayerView = PlayerView;
  window.parseChunkRanges = parseChunkRanges;
}
