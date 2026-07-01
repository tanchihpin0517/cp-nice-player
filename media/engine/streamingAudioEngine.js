function chunkIndexForTime(manifest, timeSec) {
  const chunks = manifest?.chunking?.chunks;
  if (!Array.isArray(chunks) || chunks.length === 0) {
    return 0;
  }
  const target = Math.max(0, timeSec);
  for (let i = chunks.length - 1; i >= 0; i -= 1) {
    if (target >= chunks[i].startSec) {
      return i;
    }
  }
  return 0;
}

function chunkEntry(manifest, index) {
  return manifest?.chunking?.chunks?.[index];
}

function formatChunkRanges(indices) {
  if (!indices.length) {
    return '—';
  }
  const sorted = [...indices].sort((a, b) => a - b);
  const ranges = [];
  let start = sorted[0];
  let end = sorted[0];

  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i] === end + 1) {
      end = sorted[i];
    } else {
      ranges.push(start === end ? String(start) : start + '-' + end);
      start = sorted[i];
      end = sorted[i];
    }
  }
  ranges.push(start === end ? String(start) : start + '-' + end);
  return ranges.join(', ');
}

function audioBufferToPlanar(audioBuffer) {
  const planar = [];
  for (let ch = 0; ch < audioBuffer.numberOfChannels; ch += 1) {
    planar.push(audioBuffer.getChannelData(ch));
  }
  return planar;
}

function buildLinearFade(overlapFrames) {
  const fadeIn = new Float32Array(overlapFrames);
  const fadeOut = new Float32Array(overlapFrames);
  for (let i = 0; i < overlapFrames; i += 1) {
    const t = (i + 0.5) / overlapFrames;
    fadeIn[i] = t;
    fadeOut[i] = 1 - t;
  }
  return { fadeIn, fadeOut };
}

function normalizedCrossCorrelation(tail, head, headStart, blendFrames) {
  let dot = 0;
  let tailEnergy = 0;
  let headEnergy = 0;

  for (let ch = 0; ch < tail.length; ch += 1) {
    const tailCh = tail[ch];
    const headCh = head[ch];
    for (let i = 0; i < blendFrames; i += 1) {
      const t = tailCh[i];
      const h = headCh[headStart + i];
      dot += t * h;
      tailEnergy += t * t;
      headEnergy += h * h;
    }
  }

  const denom = Math.sqrt(tailEnergy * headEnergy);
  if (denom <= 1e-12) {
    return 0;
  }
  return dot / denom;
}

function findWsolaOffset(tail, head, blendFrames, searchRadius, baseOffset = 0) {
  let bestOffset = 0;
  let bestScore = -Infinity;

  for (let offset = 0; offset <= searchRadius; offset += 1) {
    const headStart = baseOffset + offset;
    if (headStart + blendFrames > head[0].length) {
      continue;
    }
    const score = normalizedCrossCorrelation(tail, head, headStart, blendFrames);
    if (score > bestScore) {
      bestScore = score;
      bestOffset = offset;
    }
  }

  return bestOffset;
}

function linearCrossfade(tail, head, headStart, blendFrames, fadeIn, fadeOut) {
  const blended = [];
  for (let ch = 0; ch < tail.length; ch += 1) {
    const out = new Float32Array(blendFrames);
    const tailCh = tail[ch];
    const headCh = head[ch];
    for (let i = 0; i < blendFrames; i += 1) {
      out[i] = tailCh[i] * fadeOut[i] + headCh[headStart + i] * fadeIn[i];
    }
    blended.push(out);
  }
  return blended;
}

const LOOP_INTERVAL_MS = 200;
const DECODE_IDLE_MS = 200;
const INDEX_RETRY_INTERVAL_MS = 1000;
const RING_HEADROOM_SEC = 5;
const WORKLET_MODULE_URL = document.querySelector('meta[name="cp-worklet-module-url"]')?.getAttribute('content') ?? '';

class StreamingAudioEngine extends EventTarget {
  constructor() {
    super();
    this.ctx = null;
    this.scheduler = null;
    this.serverUrl = '';
    this.audioId = '';
    this.mediaName = '';
    this.manifest = null;
    this.chunkBufferCount = 5;
    this.chunkDurationSec = 1;
    this.loadGeneration = 0;
    this.indexFetchAbort = null;
    this.fetchAbortControllers = new Map();
    this.encodedChunks = new Map();
    this.fetchInFlight = new Map();
    this.decodedChunks = new Set();
    this.pausedAt = 0;
    this.playbackAnchorCtxTime = 0;
    this.isPlaying = false;
    this.volume = 1;
    this.muted = false;
    this._fetchTimer = null;
    this._decodeIdleTimer = null;
    this._timeTicker = null;
    this._indexRetryTimer = null;
    this._bufferedChunks = '—';
    this._lastWorkletStats = null;
    this._crossfadeTail = null;
  }

  async load(serverUrl, audioId, options = {}) {
    await this.close();
    this.loadGeneration += 1;
    const generation = this.loadGeneration;
    this.serverUrl = serverUrl;
    this.audioId = audioId;
    this.mediaName = options.name || '';
    this.chunkBufferCount = Math.max(1, Number(options.chunkBufferCount) || 5);
    this.chunkDurationSec = Math.max(0.5, Number(options.chunkDurationSec) || 1);
    this.pausedAt = 0;

    this._emit('loading', { serverUrl, audioId });

    const manifest = await this._fetchIndexLoop(generation);
    if (generation !== this.loadGeneration || !manifest) {
      return;
    }

    this.manifest = manifest;
    const { sampleRate } = this._manifestAudioLayout();
    this._openAudioContext(sampleRate);
    await this._initSchedulerFromManifest(generation);
    if (generation !== this.loadGeneration) {
      return;
    }
    this._emit('ready', {
      duration: manifest.durationSec,
      manifest,
    });
    this._emit('timeupdate', {
      currentTime: 0,
      duration: manifest.durationSec,
    });

    this._startFetchLoop();
    this._startDecodeLoop();
  }

  async play() {
    if (!this.manifest || this.isPlaying) {
      return;
    }

    const resuming = this.decodedChunks.size > 0
      || (this.scheduler?.framesAvailable ?? 0) > 0;

    if (!resuming) {
      this.scheduler?.reset();
      this._clearCrossfadeTail();
      this.playbackAnchorCtxTime = this.ctx.currentTime;
    }

    if (this.scheduler) {
      await this.scheduler.play();
    } else if (this.ctx.state !== 'running') {
      await this.ctx.resume();
    }

    this.isPlaying = true;
    this._startTimeTicker();
    this._emit('playing');
  }

  async pause() {
    if (!this.isPlaying) {
      return;
    }
    this.pausedAt = this.getCurrentTime();
    this.isPlaying = false;
    this._stopTimeTicker();
    if (this.scheduler) {
      await this.scheduler.pause();
    } else {
      await this._suspendAudioContext();
    }
    this._emit('pause');
    this._emit('timeupdate', {
      currentTime: this.pausedAt,
      duration: this.getDuration(),
    });
  }

  async seek(seconds) {
    if (!this.manifest) {
      return;
    }

    const duration = this.getDuration();
    const clamped = Math.min(Math.max(seconds, 0), duration);
    const wasPlaying = this.isPlaying;

    this.loadGeneration += 1;
    this._abortAllFetches();
    this.scheduler?.reset();
    this.decodedChunks.clear();
    this._clearCrossfadeTail();
    this.pausedAt = clamped;
    this.isPlaying = false;
    this._stopTimeTicker();

    this._emit('timeupdate', {
      currentTime: this.pausedAt,
      duration: this.getDuration(),
    });

    if (wasPlaying) {
      await this.play();
    }
  }

  setVolume(volume) {
    this.volume = Math.min(Math.max(Number(volume) || 0, 0), 1);
    this._syncGain();
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
    this._syncGain();
  }

  getCurrentTime() {
    if (!this.manifest) {
      return 0;
    }
    if (!this.isPlaying) {
      return this.pausedAt;
    }
    const elapsed = this.ctx.currentTime - this.playbackAnchorCtxTime;
    return Math.min(Math.max(this.pausedAt + elapsed, 0), this.manifest.durationSec);
  }

  getDuration() {
    return this.manifest?.durationSec ?? 0;
  }

  getDiagnostics() {
    const fetchInFlight = [...this.fetchInFlight.keys()].sort((a, b) => a - b);
    const currentChunk = this.manifest ? chunkIndexForTime(this.manifest, this.getCurrentTime()) : 0;
    return {
      contextState: this.manifest ? this.ctx.state : 'uninitialized',
      contextSampleRate: this.ctx?.sampleRate ?? 0,
      sampleRate: this.manifest?.sampleRate ?? 0,
      manifestChannels: this.manifest?.channels ?? 0,
      manifestSampleRate: this.manifest?.sampleRate ?? 0,
      currentTime: this.getCurrentTime(),
      duration: this.getDuration(),
      paused: !this.isPlaying,
      muted: this.muted,
      volume: this.volume,
      mediaName: this.mediaName,
      serverUrl: this.serverUrl,
      audioId: this.audioId,
      chunkBufferCount: this.chunkBufferCount,
      currentChunkIndex: currentChunk,
      fetchInFlight: formatChunkRanges(fetchInFlight),
      decodedChunks: formatChunkRanges([...this.decodedChunks].sort((a, b) => a - b)),
      ringFramesAvailable: this.scheduler?.framesAvailable ?? 0,
      ringFreeFrames: this.scheduler?.freeFrames ?? 0,
      underrunFrames: this.scheduler?.underrunFrames ?? 0,
      manifestChunkCount: this.manifest?.chunking?.count,
      manifestCrossfadeMs: this.manifest?.chunking?.crossfadeMs,
      crossfadeTailHeld: this._crossfadeTail != null,
      bufferedChunks: this._bufferedChunks,
    };
  }

  async close() {
    this.loadGeneration += 1;
    this._stopFetchLoop();
    this._stopDecodeLoop();
    this._stopTimeTicker();
    this._abortAllFetches();
    this._abortIndexFetch();
    this._clearIndexRetryTimer();
    this.isPlaying = false;
    this.scheduler?.dispose();
    this.scheduler = null;
    this.manifest = null;
    this.encodedChunks.clear();
    this._bufferedChunks = '—';
    this.fetchInFlight.clear();
    this.decodedChunks.clear();
    this._clearCrossfadeTail();
    this.serverUrl = '';
    this.audioId = '';
    if (this.ctx) {
      await this.ctx.close();
      this.ctx = null;
    }
  }

  _clearCrossfadeTail() {
    this._crossfadeTail = null;
  }

  _chunkOverlapFrames(entry, index) {
    if (!entry || !this.manifest) {
      return 0;
    }
    const crossfadeMs = this.manifest.chunking?.crossfadeMs ?? 0;
    if (crossfadeMs <= 0) {
      return 0;
    }
    const isFinal = index >= this.manifest.chunking.count - 1;
    if (isFinal) {
      return 0;
    }
    const endSec = entry.endSec;
    const crossfadeEndSec = entry.crossfadeEndSec ?? endSec;
    return Math.max(0, Math.round((crossfadeEndSec - endSec) * this.manifest.sampleRate));
  }

  _ringCapacitySec() {
    return this.chunkBufferCount * this.chunkDurationSec + RING_HEADROOM_SEC;
  }

  _manifestAudioLayout() {
    const channels = this.manifest?.channels;
    const sampleRate = this.manifest?.sampleRate;
    if (
      !Number.isInteger(channels) || channels <= 0
      || !Number.isInteger(sampleRate) || sampleRate <= 0
    ) {
      throw new Error('Index manifest is missing valid channels or sampleRate');
    }
    return { channelCount: channels, sampleRate };
  }

  _createWorkletScheduler() {
    return new WorkletScheduler({
      workletModuleUrl: WORKLET_MODULE_URL,
      ringCapacitySec: this._ringCapacitySec(),
      onStats: (stats) => {
        this._lastWorkletStats = stats;
      },
    });
  }

  async _initSchedulerFromManifest(generation) {
    if (generation !== this.loadGeneration) {
      return false;
    }

    const { channelCount, sampleRate } = this._manifestAudioLayout();

    if (!WORKLET_MODULE_URL) {
      throw new Error('Worklet module URL was not injected — reload the player panel.');
    }

    if (!this.scheduler) {
      this.scheduler = this._createWorkletScheduler();
      await this.scheduler.init(this.ctx, channelCount, sampleRate, {
        ringCapacitySec: this._ringCapacitySec(),
      });
      this._syncGain();
      return generation === this.loadGeneration;
    }

    if (
      this.scheduler.channelCount !== channelCount
      || this.scheduler.sampleRate !== sampleRate
    ) {
      this.scheduler.dispose();
      this.scheduler = this._createWorkletScheduler();
      await this.scheduler.init(this.ctx, channelCount, sampleRate, {
        ringCapacitySec: this._ringCapacitySec(),
      });
      this._syncGain();
    }

    return generation === this.loadGeneration;
  }

  _getBufferWindow() {
    const currentChunk = chunkIndexForTime(this.manifest, this.getCurrentTime());
    const targetEnd = Math.min(
      currentChunk + this.chunkBufferCount - 1,
      this.manifest.chunking.count - 1,
    );
    return { currentChunk, targetEnd };
  }

  _hasPendingChunksToWrite() {
    if (!this.manifest) {
      return false;
    }
    const { targetEnd } = this._getBufferWindow();
    const first = this._nextChunkToSchedule();
    if (first == null || first > targetEnd) {
      return false;
    }
    for (let index = first; index <= targetEnd; index += 1) {
      if (!this.decodedChunks.has(index)) {
        return true;
      }
    }
    return false;
  }

  _checkPlaybackEnded() {
    if (!this.isPlaying || !this.manifest) {
      return;
    }
    const duration = this.manifest.durationSec;
    if (this.getCurrentTime() < duration - 0.05) {
      return;
    }
    if (this._hasPendingChunksToWrite()) {
      return;
    }
    this.isPlaying = false;
    this.pausedAt = 0;
    this._stopTimeTicker();
    this.scheduler?.reset();
    this.decodedChunks.clear();
    this._clearCrossfadeTail();
    void this.scheduler?.pause();
    this._emit('ended');
    this._emit('timeupdate', {
      currentTime: 0,
      duration: this.getDuration(),
    });
  }

  _streamUrl(pathname) {
    const url = new URL(pathname, this.serverUrl);
    url.searchParams.set('audioId', this.audioId);
    return url;
  }

  async _fetchIndexLoop(generation) {
    while (generation === this.loadGeneration) {
      try {
        const manifest = await this._fetchIndex(generation);
        if (generation !== this.loadGeneration) {
          return null;
        }
        return manifest;
      } catch (error) {
        if (generation !== this.loadGeneration || error?.name === 'AbortError') {
          return null;
        }
        const message = error instanceof Error ? error.message : String(error);
        this._emit('error', { message });
        await this._waitIndexRetry();
      }
    }
    return null;
  }

  _waitIndexRetry() {
    return new Promise((resolve) => {
      this._clearIndexRetryTimer();
      this._indexRetryTimer = setTimeout(() => {
        this._indexRetryTimer = null;
        resolve();
      }, INDEX_RETRY_INTERVAL_MS);
    });
  }

  _clearIndexRetryTimer() {
    if (this._indexRetryTimer) {
      clearTimeout(this._indexRetryTimer);
      this._indexRetryTimer = null;
    }
  }

  async _fetchIndex(generation) {
    this._abortIndexFetch();
    this.indexFetchAbort = new AbortController();
    const url = this._streamUrl('/index');
    const response = await fetch(url, {
      signal: this.indexFetchAbort.signal,
    });
    if (generation !== this.loadGeneration) {
      throw new DOMException('Aborted', 'AbortError');
    }
    if (!response.ok) {
      const body = await response.text();
      throw new Error('index ' + response.status + ': ' + body);
    }
    return response.json();
  }

  _maintainEncodedWindow() {
    if (!this.manifest) {
      return;
    }
    if (this.fetchInFlight.size > 0) {
      this._updateBufferingState();
      return;
    }
    const generation = this.loadGeneration;
    const { currentChunk, targetEnd } = this._getBufferWindow();
    for (let index = currentChunk; index <= targetEnd; index += 1) {
      if (this.encodedChunks.has(index)) {
        continue;
      }
      void this._fetchChunk(index, generation).catch((error) => {
        if (error?.name !== 'AbortError') {
          this._emit('error', { message: String(error) });
        }
      });
      break;
    }
    this._updateBufferingState();
  }

  _nextChunkToSchedule() {
    if (this.decodedChunks.size > 0) {
      return Math.max(...this.decodedChunks) + 1;
    }
    return chunkIndexForTime(this.manifest, this.pausedAt);
  }

  _countEncodableChunks(first, targetEnd) {
    let pending = 0;
    let ready = 0;
    for (let index = first; index <= targetEnd; index += 1) {
      if (this.decodedChunks.has(index)) {
        continue;
      }
      pending += 1;
      if (this.encodedChunks.has(index)) {
        ready += 1;
      }
    }
    return { pending, ready };
  }

  async _decodeAvailableChunks(generation) {
    if (!this.isPlaying) {
      return;
    }

    const { targetEnd } = this._getBufferWindow();
    const first = this._nextChunkToSchedule();
    if (first == null) {
      return;
    }

    const { pending, ready } = this._countEncodableChunks(first, targetEnd);
    const required = Math.min(2, pending);
    if (ready < required) {
      return;
    }

    for (let index = first; index <= targetEnd; index += 1) {
      if (generation !== this.loadGeneration) {
        break;
      }
      if (this.decodedChunks.has(index)) {
        continue;
      }
      if (!this.encodedChunks.has(index)) {
        continue;
      }

      await this._decodeAndWriteChunk(index, generation);
    }
  }

  async _runDecodeIteration(generation) {
    if (!this.manifest) {
      return;
    }

    try {
      if (generation === this.loadGeneration) {
        await this._decodeAvailableChunks(generation);
      }
    } catch (error) {
      this._emit('error', { message: String(error) });
    } finally {
      if (this.manifest) {
        this._scheduleDecodeIteration();
      }
    }
  }

  _scheduleDecodeIteration() {
    this._clearDecodeIdleTimer();
    if (!this.manifest) {
      return;
    }

    this._decodeIdleTimer = setTimeout(() => {
      this._decodeIdleTimer = null;
      void this._runDecodeIteration(this.loadGeneration);
    }, DECODE_IDLE_MS);
  }

  _clearDecodeIdleTimer() {
    if (this._decodeIdleTimer) {
      clearTimeout(this._decodeIdleTimer);
      this._decodeIdleTimer = null;
    }
  }

  _updateBufferingState() {
    const buffered = [...this.encodedChunks.keys()];
    this._bufferedChunks = formatChunkRanges(buffered);
  }

  async _fetchChunk(index, generation) {
    if (this.encodedChunks.has(index)) {
      return this.encodedChunks.get(index);
    }
    const inFlight = this.fetchInFlight.get(index);
    if (inFlight) {
      return inFlight;
    }

    const task = (async () => {
      const controller = new AbortController();
      this.fetchAbortControllers.set(index, controller);

      try {
        const response = await fetch(this._streamUrl('/chunk/' + index), {
          signal: controller.signal,
        });
        if (generation !== this.loadGeneration) {
          throw new DOMException('Aborted', 'AbortError');
        }
        if (!response.ok) {
          const body = await response.text();
          throw new Error('chunk ' + index + ' ' + response.status + ': ' + body);
        }

        const bytes = await response.arrayBuffer();
        if (generation !== this.loadGeneration) {
          throw new DOMException('Aborted', 'AbortError');
        }

        this.encodedChunks.set(index, bytes);
        this._updateBufferingState();
        this._emit('chunkfinished', {
          chunkIndex: index,
          bytes: bytes.byteLength,
        });
        return bytes;
      } finally {
        this.fetchAbortControllers.delete(index);
      }
    })().finally(() => {
      this.fetchInFlight.delete(index);
    });

    this.fetchInFlight.set(index, task);
    return task;
  }

  async _decodeAndWriteChunk(index, generation) {
    if (this.decodedChunks.has(index)) {
      return null;
    }

    const bytes = this.encodedChunks.get(index);
    if (!bytes) {
      return null;
    }

    try {
      const decodeStart = performance.now();
      const audioBuffer = await this._decodeBytes(bytes);
      if (generation !== this.loadGeneration) {
        return null;
      }

      if (
        audioBuffer.numberOfChannels !== this.manifest.channels
        || audioBuffer.sampleRate !== this.manifest.sampleRate
      ) {
        throw new Error(
          'Decoded layout differs from manifest ('
            + audioBuffer.numberOfChannels + 'ch @ ' + audioBuffer.sampleRate + ' Hz vs manifest '
            + this.manifest.channels + 'ch @ ' + this.manifest.sampleRate + ' Hz)',
        );
      }

      if (!this.scheduler) {
        throw new Error('Worklet scheduler is not initialized');
      }

      const entry = chunkEntry(this.manifest, index);
      const overlapFrames = this._chunkOverlapFrames(entry, index);
      const isFinal = index >= this.manifest.chunking.count - 1;

      const offsetSec = this.decodedChunks.size === 0
        ? Math.min(
          Math.max(0, this.pausedAt - (entry?.startSec ?? 0)),
          audioBuffer.duration,
        )
        : 0;
      let start = Math.floor(offsetSec * this.manifest.sampleRate);
      const frames = audioBuffer.length;
      if (start >= frames) {
        return null;
      }

      const planar = audioBufferToPlanar(audioBuffer);
      const fade = overlapFrames > 0 ? buildLinearFade(overlapFrames) : null;
      let wsolaShiftSamples = null;

      if (this._crossfadeTail && overlapFrames > 0) {
        const tailLen = this._crossfadeTail[0].length;
        const blendFrames = Math.min(overlapFrames, frames - start, tailLen);
        if (blendFrames > 0) {
          const searchRadius = overlapFrames;
          wsolaShiftSamples = findWsolaOffset(
            this._crossfadeTail,
            planar,
            blendFrames,
            searchRadius,
            start,
          );
          const headStart = start + wsolaShiftSamples;
          const blended = linearCrossfade(
            this._crossfadeTail,
            planar,
            headStart,
            blendFrames,
            fade.fadeIn,
            fade.fadeOut,
          );
          await this.scheduler.writeChannels(blended, blendFrames);
          if (generation !== this.loadGeneration) {
            return null;
          }
          start = headStart + blendFrames;
        }
        this._crossfadeTail = null;
      }

      const bodyEnd = isFinal ? frames : Math.max(start, frames - overlapFrames);
      const bodyFrames = bodyEnd - start;
      if (bodyFrames > 0) {
        const bodyChannels = planar.map((ch) => ch.subarray(start, bodyEnd));
        await this.scheduler.writeChannels(bodyChannels, bodyFrames);
        if (generation !== this.loadGeneration) {
          return null;
        }
      }

      if (!isFinal && overlapFrames > 0) {
        const tailStart = Math.max(0, frames - overlapFrames);
        this._crossfadeTail = planar.map((ch) => ch.slice(tailStart, frames));
      } else {
        this._crossfadeTail = null;
      }

      if (generation !== this.loadGeneration) {
        return null;
      }

      this.decodedChunks.add(index);
      const elapsedMs = performance.now() - decodeStart;
      this._emit('decodefinished', {
        chunkIndex: index,
        elapsedMs,
        wsolaShiftSamples,
      });
      this._checkPlaybackEnded();

      return index;
    }
    catch (error) {
      this._emit('error', { message: String(error) });
      return null;
    }
  }

  async _suspendAudioContext() {
    if (this.ctx.state === 'running') {
      this.playbackAnchorCtxTime = this.ctx.currentTime;
      await this.ctx.suspend();
    }
  }

  _abortAllFetches() {
    for (const controller of this.fetchAbortControllers.values()) {
      controller.abort();
    }
    this.fetchAbortControllers.clear();
    this.fetchInFlight.clear();
  }

  _abortIndexFetch() {
    this._clearIndexRetryTimer();
    this.indexFetchAbort?.abort();
    this.indexFetchAbort = null;
  }

  async _decodeBytes(bytes) {
    const cloned = bytes.slice(0);
    return this.ctx.decodeAudioData(cloned);
  }

  _openAudioContext(sampleRate) {
    this.ctx = new AudioContext({ sampleRate });
  }

  _syncGain() {
    if (this.scheduler) {
      this.scheduler.setVolume(this.muted ? 0 : this.volume);
    }
  }

  _startFetchLoop() {
    this._stopFetchLoop();
    this._fetchTimer = setInterval(() => {
      this._maintainEncodedWindow();
    }, LOOP_INTERVAL_MS);
    this._maintainEncodedWindow();
  }

  _stopFetchLoop() {
    if (this._fetchTimer) {
      clearInterval(this._fetchTimer);
      this._fetchTimer = null;
    }
  }

  _startDecodeLoop() {
    void this._runDecodeIteration(this.loadGeneration);
  }

  _stopDecodeLoop() {
    this._clearDecodeIdleTimer();
  }

  _startTimeTicker() {
    this._stopTimeTicker();
    this._timeTicker = setInterval(() => {
      if (!this.isPlaying) {
        return;
      }
      this._checkPlaybackEnded();
      if (!this.isPlaying) {
        return;
      }
      this._emit('timeupdate', {
        currentTime: this.getCurrentTime(),
        duration: this.getDuration(),
      });
    }, LOOP_INTERVAL_MS);
  }

  _stopTimeTicker() {
    if (this._timeTicker) {
      clearInterval(this._timeTicker);
      this._timeTicker = null;
    }
  }

  _emit(type, detail = {}) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}

window.StreamingAudioEngine = StreamingAudioEngine;
