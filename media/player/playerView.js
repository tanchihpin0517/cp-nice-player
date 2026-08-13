/*
 * View layer for the player. Owns the DOM and nothing else: it talks to an
 * object with the StreamingAudioEngine interface (load/play/pause/seek/
 * setVolume/setMuted/getDiagnostics + events), so the same file drives the real
 * engine in the webview and the mock engine in the standalone demo.
 *
 * Locators and looping live here rather than in the engine: a loop is a seek
 * back to the in point when the playhead passes the out point, and the engine
 * already does fast seeks.
 *
 * Depends on globals from formatUtils.js and waveform.js.
 */

const SKIP_SECONDS = 10;
const NUDGE_SECONDS = 0.1;
const MAX_LOG_ENTRIES = 60;
/** Marks a bucket the engine has not decoded yet, as opposed to a silent one. */
const UNMEASURED = -1;
/** A ruler drag shorter than this is a click, and a click clears the locators. */
const MIN_REGION_SECONDS = 0.08;

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

/** What the tape window says when there is no tape on it. */
const WELL_LEGENDS = {
  empty: {
    title: 'No tape loaded',
    hint: 'Open an audio file, or pick <b>CP\'s Nice Player</b> from the editor title bar'
      + ' or the <b>Open With…</b> menu.',
  },
  loading: {
    title: 'Reading index',
    hint: 'The chunk map is being built from the file. Playback can start as soon as'
      + ' the first chunk lands.',
  },
  /*
   * The band names the failure; the well names only its own state, so the recess
   * is never an unlabelled void and never repeats what the band already said.
   */
  error: { title: 'No tape', hint: '' },
};

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
    this.marking = false;
    this.markAnchor = 0;
    this.locators = { in: null, out: null };
    this.looping = false;
    this._wrapping = false;
    this._clockText = null;
    this._clockSpans = [];
    this.el = {};

    const id = (name) => root.querySelector('#' + name);
    this.el = {
      name: id('trackName'),
      chipFormat: id('chipFormat'),
      chipLayout: id('chipLayout'),
      chipChunks: id('chipChunks'),
      fieldChunk: id('fieldChunk'),
      fieldRing: id('fieldRing'),
      fieldUnderrun: id('fieldUnderrun'),
      fieldUnderrunWrap: id('fieldUnderrunWrap'),
      status: id('trackStatus'),
      statusText: id('trackStatusText'),
      wave: id('wave'),
      waveCanvas: id('waveCanvas'),
      waveHover: id('waveHover'),
      waveHoverTime: id('waveHoverTime'),
      wellTitle: id('wellTitle'),
      wellHint: id('wellHint'),
      currentTime: id('currentTime'),
      durationTime: id('durationTime'),
      remainingTime: id('remainingTime'),
      playPause: id('playPause'),
      playLabel: id('playLabel'),
      skipStart: id('skipStart'),
      skipBack: id('skipBack'),
      skipForward: id('skipForward'),
      loopToggle: id('loopToggle'),
      loopReadout: id('loopReadout'),
      muteBtn: id('muteBtn'),
      volume: id('volume'),
      levelValue: id('levelValue'),
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

    this._bindControls();
    this._bindWaveform();
    this._bindEngine();
    this._bindKeyboard();

    this.setState('empty');
    this.setControlsEnabled(false);
    this._renderClock(0);
    this._renderVolume();
    this.renderServerPanel();
    this.renderPlaybackPanel();
  }

  // --------------------------------------------------------------- state

  setState(state) {
    this.root.dataset.state = state;
    const legend = WELL_LEGENDS[state];
    if (legend && this.el.wellTitle) {
      this.el.wellTitle.textContent = legend.title;
      this.el.wellHint.innerHTML = legend.hint;
    }
  }

  /**
   * Nothing to play at all. The band keeps its fixed vocabulary — a raw fetch
   * error set in tracked caps is unreadable — and takes the message and the two
   * recovery keys itself, so the failure is stated once.
   */
  setError(message) {
    this.setState('error');
    this.setStatus('No stream', 'error');
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
    for (const key of ['playPause', 'skipStart', 'skipBack', 'skipForward', 'muteBtn', 'volume']) {
      this.el[key].disabled = !enabled;
    }
    this.el.wave.setAttribute('aria-disabled', String(!enabled));
    this.controlsEnabled = enabled;
    this._syncLoopKey();
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
    this.el.durationTime.textContent = '—';
    this._renderClock(0);
    this.clearLocators();

    this.setState('loading');
    this.setStatus('Reading index', 'busy');
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
    this.el.skipStart.addEventListener('click', () => void this.seekTo(0));
    this.el.skipBack.addEventListener('click', () => void this.skip(-SKIP_SECONDS));
    this.el.skipForward.addEventListener('click', () => void this.skip(SKIP_SECONDS));
    this.el.loopToggle.addEventListener('click', () => void this.toggleLoop());

    this.el.muteBtn.addEventListener('click', () => {
      const muted = this.root.dataset.muted !== 'true';
      this.root.dataset.muted = String(muted);
      this.engine.setMuted(muted);
      this.el.muteBtn.setAttribute('aria-label', muted ? 'Unmute' : 'Mute');
      this.el.muteBtn.dataset.lit = String(muted);
    });

    this.el.volume.addEventListener('input', () => {
      this.engine.setVolume(Number(this.el.volume.value));
      if (this.root.dataset.muted === 'true') {
        this.root.dataset.muted = 'false';
        this.engine.setMuted(false);
        this.el.muteBtn.dataset.lit = 'false';
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
    this.setStatus('Seeking', 'busy');
    try {
      await this.engine.seek(seconds);
      this.setStatus(this._runningStatus(wasPlaying), wasPlaying ? 'live' : 'idle');
    } catch (error) {
      this.setStatus('Seek failed: ' + errorText(error), 'error');
      this.logEvent('error', errorText(error), 'error');
    }
    this.sync();
  }

  _runningStatus(playing) {
    if (!playing) {
      return 'Paused';
    }
    return this.looping ? 'Looping' : 'Playing';
  }

  // ------------------------------------------------------------- locators

  /**
   * The locators are the answer to "let me hear that bit again": mark a region by
   * dragging the ruler, then latch LOOP. Tape machines call these locate points,
   * and the transport keys keep their ordinary meaning while a region exists.
   */
  setLocators(from, to) {
    const duration = this.engine.getDuration() || 0;
    let start = clamp(Math.min(from, to), 0, duration);
    let end = clamp(Math.max(from, to), 0, duration);
    if (end - start < MIN_REGION_SECONDS) {
      this.clearLocators();
      return;
    }
    this.locators = { in: start, out: end };
    this.waveform.setLocators(this.locators);
    this._renderLocators();
    this._syncLoopKey();
  }

  clearLocators() {
    this.locators = { in: null, out: null };
    this.looping = false;
    this.root.dataset.loop = 'off';
    this.waveform.setLocators(this.locators);
    this.waveform.setLoopActive(false);
    this._renderLocators();
    this._syncLoopKey();
  }

  /** Sets one edge from the playhead, so the region can be built by ear. */
  markFromPlayhead(edge) {
    if (!this.controlsEnabled) {
      return;
    }
    const at = this.engine.getCurrentTime();
    const other = edge === 'in' ? this.locators.out : this.locators.in;
    if (other == null) {
      // A single mark is not yet a region: hold it until the other edge lands.
      this.locators = edge === 'in' ? { in: at, out: null } : { in: null, out: at };
      this.waveform.setLocators(this.locators);
      this._renderLocators();
      this._syncLoopKey();
      return;
    }
    this.setLocators(at, other);
  }

  hasRegion() {
    return this.locators.in != null && this.locators.out != null
      && this.locators.out - this.locators.in >= MIN_REGION_SECONDS;
  }

  async toggleLoop() {
    if (!this.hasRegion()) {
      return;
    }
    this.looping = !this.looping;
    this.root.dataset.loop = this.looping ? 'on' : 'off';
    this.el.loopToggle.setAttribute('aria-pressed', String(this.looping));
    this.el.loopToggle.dataset.lit = String(this.looping);
    this.waveform.setLoopActive(this.looping);
    this.logEvent('loop', this.looping
      ? formatClock(this.locators.in) + ' → ' + formatClock(this.locators.out)
      : 'off');

    const at = this.engine.getCurrentTime();
    if (this.looping && (at < this.locators.in || at > this.locators.out)) {
      await this.seekTo(this.locators.in);
    } else {
      this.setStatus(this._runningStatus(!this.engine.getDiagnostics().paused),
        this.engine.getDiagnostics().paused ? 'idle' : 'live');
    }
  }

  _syncLoopKey() {
    const usable = this.controlsEnabled && this.hasRegion();
    this.el.loopToggle.disabled = !usable;
    if (!usable && this.looping) {
      this.looping = false;
      this.root.dataset.loop = 'off';
      this.el.loopToggle.dataset.lit = 'false';
      this.el.loopToggle.setAttribute('aria-pressed', 'false');
      this.waveform.setLoopActive(false);
    }
  }

  /** Engraved label plus mono value, like every other reading on the plate. */
  _renderLocators() {
    const { in: from, out: to } = this.locators;
    const reading = (label, value) => '<span class="cp-engraved">' + label + '</span> '
      + '<b>' + escapeHtml(value) + '</b>';

    if (from == null && to == null) {
      this.el.loopReadout.innerHTML = '';
      return;
    }
    if (from == null || to == null) {
      const edge = from == null ? 'Out' : 'In';
      this.el.loopReadout.innerHTML = reading(edge, formatClock(from ?? to))
        + reading('Set the other edge', from == null ? '[' : ']');
      return;
    }
    this.el.loopReadout.innerHTML = reading('In', formatClock(from))
      + reading('Out', formatClock(to))
      + reading('Len', (to - from).toFixed(3) + 's');
  }

  // ------------------------------------------------------------- waveform

  _bindWaveform() {
    const { wave } = this.el;

    const pointAt = (event) => {
      const rect = wave.getBoundingClientRect();
      return {
        time: this.waveform.timeAtX(event.clientX - rect.left),
        region: this.waveform.regionAtY(event.clientY - rect.top),
        x: event.clientX - rect.left,
        width: rect.width,
      };
    };

    wave.addEventListener('pointermove', (event) => {
      if (wave.getAttribute('aria-disabled') === 'true') {
        return;
      }
      const point = pointAt(event);
      this.el.waveHover.style.left = clamp(point.x, 36, point.width - 36) + 'px';
      this.el.waveHoverTime.textContent = formatClock(point.time);
      this.waveform.setHoverTime(point.time);

      if (this.marking) {
        this.setLocators(this.markAnchor, point.time);
      } else if (this.scrubbing) {
        this._renderClock(point.time);
        this.waveform.setProgress(point.time);
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
      const point = pointAt(event);
      wave.setPointerCapture(event.pointerId);

      // Two gestures, split by register: the ruler marks, the tape seeks.
      if (point.region === 'ruler') {
        this.marking = true;
        this.markAnchor = point.time;
        wave.dataset.marking = 'true';
        this.clearLocators();
        return;
      }

      this.scrubbing = true;
      wave.dataset.scrubbing = 'true';
      this.waveform.setProgress(point.time);
      this._renderClock(point.time);
    });

    wave.addEventListener('pointerup', (event) => {
      const point = pointAt(event);
      if (this.marking) {
        this.marking = false;
        wave.dataset.marking = 'false';
        this.setLocators(this.markAnchor, point.time);
        return;
      }
      if (!this.scrubbing) {
        return;
      }
      this.scrubbing = false;
      wave.dataset.scrubbing = 'false';
      void this.seekTo(point.time);
    });

    wave.addEventListener('keydown', (event) => {
      const step = event.altKey ? NUDGE_SECONDS : (event.shiftKey ? 30 : 5);
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
      } else if (event.key === 'L') {
        void this.toggleLoop();
      } else if (event.key === 'l') {
        void this.skip(SKIP_SECONDS);
      } else if (event.key === '[') {
        this.markFromPlayhead('in');
      } else if (event.key === ']') {
        this.markFromPlayhead('out');
      } else if (event.key === '\\') {
        this.clearLocators();
      }
    });
  }

  // --------------------------------------------------------------- engine

  _bindEngine() {
    const on = (name, handler) => this.engine.addEventListener(name, handler);

    on('loading', () => {
      this.setState('loading');
      this.setStatus('Loading', 'busy');
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
      this.el.playPause.dataset.lit = 'true';
      this.el.playLabel.textContent = 'Pause';
      this.setStatus(this._runningStatus(true), 'live');
      this.sync();
    });

    on('pause', () => {
      this.root.dataset.playing = 'false';
      this.el.playPause.setAttribute('aria-label', 'Play');
      this.el.playPause.dataset.lit = 'false';
      this.el.playLabel.textContent = 'Play';
      this.setStatus('Paused', 'idle');
      this.sync();
    });

    on('ended', () => {
      this.root.dataset.playing = 'false';
      this.el.playPause.dataset.lit = 'false';
      this.el.playLabel.textContent = 'Play';
      this.setStatus('Ended', 'idle');
      this.sync();
    });

    on('timeupdate', (event) => {
      if (!this.scrubbing) {
        this._renderClock(event.detail.currentTime);
        this.waveform.setProgress(event.detail.currentTime);
      }
      this._wrapLoop(event.detail.currentTime);
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

  /** A loop is a seek back to the in point, guarded against re-entering itself. */
  _wrapLoop(currentTime) {
    if (!this.looping || this._wrapping || !this.hasRegion()) {
      return;
    }
    if (currentTime < this.locators.out) {
      return;
    }
    this._wrapping = true;
    void Promise.resolve(this.engine.seek(this.locators.in))
      .catch((error) => this.logEvent('error', errorText(error), 'error'))
      .finally(() => {
        this._wrapping = false;
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

    // A machine with no stream on it reports no lengths: a total next to a
    // remaining time next to a dead transport is three readings that disagree.
    const dead = this.root.dataset.state === 'empty' || this.root.dataset.state === 'error';

    if (diag.duration && !dead) {
      this.waveform.setDuration(diag.duration);
      this.el.durationTime.textContent = formatTime(diag.duration);
      this.el.remainingTime.textContent = 'Rem −'
        + formatTime(Math.max(0, diag.duration - diag.currentTime));
      const progress = clamp(diag.currentTime / diag.duration, 0, 1);
      this.el.wave.setAttribute('aria-valuenow', String(Math.round(progress * 100)));
      this.el.wave.setAttribute('aria-valuetext', formatClock(diag.currentTime));
    } else if (dead) {
      this.waveform.setDuration(0);
      this.el.durationTime.textContent = '—';
      this.el.remainingTime.textContent = '';
      this.el.wave.setAttribute('aria-valuenow', '0');
      this.el.wave.setAttribute('aria-valuetext', 'no stream');
    }

    const layout = formatAudioLayout(diag);
    this.el.chipLayout.textContent = layout === '—' ? '' : layout;
    this.el.chipChunks.textContent = diag.manifestChunkCount
      ? diag.manifestChunkCount + ' × ' + (this.context?.debug.chunkDurationSec ?? 1) + 's'
      : '';

    this._renderDataLine(diag, dead);
    this.renderPlaybackPanel(diag);
  }

  /**
   * The closed diagnostics still reports the machine's full identity, including
   * every reading's limit — a ring depth without its capacity, or an underrun
   * count without its sign, is a number nobody can act on.
   */
  _renderDataLine(diag, dead) {
    if (dead) {
      this.el.fieldChunk.textContent = '';
      this.el.fieldRing.textContent = '';
      this.el.fieldUnderrun.textContent = '';
      return;
    }

    this.el.fieldChunk.textContent = diag.manifestChunkCount
      ? diag.currentChunkIndex + ' / ' + diag.manifestChunkCount
      : '';

    const rate = diag.manifestSampleRate;
    if (rate && diag.ringFramesAvailable != null) {
      const heldMs = (diag.ringFramesAvailable / rate) * 1000;
      const capMs = ((diag.ringFramesAvailable + (diag.ringFreeFrames ?? 0)) / rate) * 1000;
      this.el.fieldRing.textContent = Math.round(heldMs) + ' / ' + Math.round(capMs) + ' ms';
      this.el.fieldRing.parentElement.dataset.tone = heldMs < 120 ? 'warn' : '';
    } else {
      this.el.fieldRing.textContent = '';
    }

    const underrun = diag.underrunFrames ?? 0;
    this.el.fieldUnderrun.textContent = '+' + underrun;
    this.el.fieldUnderrunWrap.dataset.tone = underrun > 0 ? 'warn' : '';
  }

  // -------------------------------------------------------------- counter

  /**
   * Two registers, split at the decimal point so the milliseconds can be set
   * smaller: the seconds carry the reading, the milliseconds qualify it. Nothing
   * here animates — the counter is a value to read, not a state change to stage.
   */
  _renderClock(seconds) {
    const el = this.el.currentTime;
    if (!el) {
      return;
    }

    const text = formatClock(seconds);
    if (text === this._clockText) {
      return;
    }

    const dot = text.indexOf('.');
    const seconds_ = dot < 0 ? text : text.slice(0, dot);
    const millis = dot < 0 ? '' : text.slice(dot);

    if (!this._clockSpans.length) {
      const doc = el.ownerDocument;
      const main = doc.createElement('span');
      main.className = 'cp-digit';
      const tail = doc.createElement('span');
      tail.className = 'cp-digit';
      tail.dataset.ms = 'true';
      el.textContent = '';
      el.append(main, tail);
      this._clockSpans = [main, tail];
    }

    this._clockSpans[0].textContent = seconds_;
    this._clockSpans[1].textContent = millis;
    this._clockText = text;
  }

  _renderVolume() {
    const level = Number(this.el.volume.value);
    this.el.volume.style.setProperty('--cp-range-fill', level * 100 + '%');
    if (this.el.levelValue) {
      this.el.levelValue.textContent = String(Math.round(level * 100));
    }
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
      field('playhead', d.currentTime.toFixed(3) + 's / ' + d.duration.toFixed(3) + 's'),
      field('locators', this.hasRegion()
        ? formatClock(this.locators.in) + ' → ' + formatClock(this.locators.out)
          + (this.looping ? ' (looping)' : '')
        : 'none'),
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
