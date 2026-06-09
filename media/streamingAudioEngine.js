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

const LOOP_INTERVAL_MS = 200;
const DECODE_IDLE_MS = 200;
const INDEX_RETRY_INTERVAL_MS = 1000;

class StreamingAudioEngine extends EventTarget {
  constructor() {
    super();
    this.ctx = null;
    this.gainNode = null;
    this.serverUrl = '';
    this.audioId = '';
    this.mediaName = '';
    this.manifest = null;
    this.chunkBufferCount = 5;
    this.fetchConcurrency = 1;
    this.loadGeneration = 0;
    this.indexFetchAbort = null;
    this.fetchAbortControllers = new Map();
    this.encodedChunks = new Map();
    this.fetchInFlight = new Map();
    this.decodedChunks = new Set();
    this.activeSources = [];
    this.nextPlayTime = 0;
    this.pausedAt = 0;
    this.playbackAnchorCtxTime = 0;
    this.isPlaying = false;
    this.volume = 1;
    this.muted = false;
    this.decoderType = 'none';
    this._fetchTimer = null;
    this._decodeIdleTimer = null;
    this._timeTicker = null;
    this._indexRetryTimer = null;
    this._bufferedChunks = '—';
  }

  async load(serverUrl, audioId, options = {}) {
    await this.close();
    this.loadGeneration += 1;
    const generation = this.loadGeneration;
    this.serverUrl = serverUrl;
    this.audioId = audioId;
    this.mediaName = options.name || '';
    this.chunkBufferCount = Math.max(1, Number(options.chunkBufferCount) || 5);
    this.fetchConcurrency = Math.max(1, Number(options.fetchConcurrency) || 1);
    this.pausedAt = 0;
    this.decoderType = 'none';

    this._emit('loading', { serverUrl, audioId });

    const manifest = await this._fetchIndexLoop(generation);
    if (generation !== this.loadGeneration || !manifest) {
      return;
    }

    this.manifest = manifest;
    this._openAudioContext();
    this._emitStreamStatus('index', 'ready', { count: manifest.chunking.count });
    this._emit('ready', {
      duration: manifest.durationSec,
      decoderType: this.decoderType,
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

    const resuming = this.activeSources.length > 0;

    if (this.ctx.state !== 'running') {
      await this.ctx.resume();
    }

    this.isPlaying = true;
    if (!resuming) {
      this.playbackAnchorCtxTime = this.ctx.currentTime;
      this.nextPlayTime = this.ctx.currentTime;
    }
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
    await this._suspendAudioContext();
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
    this._stopAllSources();
    this.decodedChunks.clear();
    this.pausedAt = clamped;
    this.isPlaying = false;

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
    if (this.activeSources.length === 0) {
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
      mode: 'streaming',
      contextState: this.manifest ? this.ctx.state : 'uninitialized',
      sampleRate: this.manifest ? this.ctx.sampleRate : 0,
      currentTime: this.getCurrentTime(),
      duration: this.getDuration(),
      paused: !this.isPlaying,
      muted: this.muted,
      volume: this.volume,
      decoderType: this.decoderType,
      mediaName: this.mediaName,
      serverUrl: this.serverUrl,
      audioId: this.audioId,
      chunkBufferCount: this.chunkBufferCount,
      fetchConcurrency: this.fetchConcurrency,
      currentChunkIndex: currentChunk,
      fetchInFlight: formatChunkRanges(fetchInFlight),
      fetchLoopActive: this._fetchTimer != null,
      decodeLoopActive: this.manifest != null,
      activeSources: formatChunkRanges(
        this.activeSources
          .map((source) => source._chunkIndex)
          .filter((index) => index != null),
      ),
      decodedChunks: formatChunkRanges([...this.decodedChunks].sort((a, b) => a - b)),
      nextPlayTime: this.nextPlayTime,
      manifestStrategy: this.manifest?.chunking?.strategy,
      manifestChunkCount: this.manifest?.chunking?.count,
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
    this._stopAllSources();
    this.manifest = null;
    this.encodedChunks.clear();
    this._bufferedChunks = '—';
    this.fetchInFlight.clear();
    this.decodedChunks.clear();
    this.serverUrl = '';
    this.audioId = '';
    if (this.ctx) {
      await this.ctx.close();
      this.ctx = null;
      this.gainNode = null;
    }
  }

  _getBufferWindow() {
    const currentChunk = chunkIndexForTime(this.manifest, this.getCurrentTime());
    const targetEnd = Math.min(
      currentChunk + this.chunkBufferCount - 1,
      this.manifest.chunking.count - 1,
    );
    return { currentChunk, targetEnd };
  }

  _streamUrl(pathname) {
    const url = new URL(pathname, this.serverUrl);
    url.searchParams.set('audioId', this.audioId);
    return url;
  }

  async _fetchIndexLoop(generation) {
    while (generation === this.loadGeneration) {
      this._emitStreamStatus('index', 'started');
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
        this._emitStreamStatus('index', 'failed', { detail: message });
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
    this._emit('debug', { message: 'fetching index from ' + url });
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
    const generation = this.loadGeneration;
    const { currentChunk, targetEnd } = this._getBufferWindow();

    let inFlightInWindow = 0;
    for (let index = currentChunk; index <= targetEnd; index += 1) {
      if (this.fetchInFlight.has(index)) {
        inFlightInWindow += 1;
      }
    }
    const slotsAvailable = Math.max(0, this.fetchConcurrency - inFlightInWindow);
    let started = 0;

    for (let index = currentChunk; index <= targetEnd; index += 1) {
      if (started >= slotsAvailable) {
        break;
      }
      if (this.encodedChunks.has(index) || this.fetchInFlight.has(index)) {
        continue;
      }
      void this._fetchChunk(index, generation).catch((error) => {
        if (error?.name !== 'AbortError') {
          this._emit('error', { message: String(error) });
        }
      });
      started += 1;
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

      await this._decodeAndScheduleChunk(index, generation);
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
      this._emitStreamStatus('chunk', 'started', { chunkIndex: index });
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
        this._emitStreamStatus('chunk', 'fetched', {
          chunkIndex: index,
          cache: response.headers.get('X-Cache') || 'unknown',
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

  async _decodeAndScheduleChunk(index, generation) {
    if (this.decodedChunks.has(index)) {
      return null;
    }

    const bytes = this.encodedChunks.get(index);
    if (!bytes) {
      return null;
    }

    this._emitStreamStatus('decode', 'started', { chunkIndex: index });

    try {
      const audioBuffer = await this._decodeBytes(bytes);
      if (generation !== this.loadGeneration) {
        return null;
      }

      if (this.nextPlayTime < this.ctx.currentTime) {
        this.nextPlayTime = this.ctx.currentTime;
      }

      const offsetSec = this.activeSources.length === 0
        ? Math.min(
          Math.max(0, this.pausedAt - chunkEntry(this.manifest, index).startSec),
          audioBuffer.duration,
        )
        : 0;
      const playDuration = Math.max(0, audioBuffer.duration - offsetSec);
      if (playDuration <= 0) {
        return null;
      }

      const source = this.ctx.createBufferSource();
      source.buffer = audioBuffer;
      source._chunkIndex = index;
      source.connect(this.gainNode);
      source.start(this.nextPlayTime, offsetSec);
      this.activeSources.push(source);
      this.nextPlayTime += playDuration;
      this.decodedChunks.add(index);

      this._emitStreamStatus('decode', 'ready', { chunkIndex: index });

      source.onended = () => {
        this._removeSource(source);
        if (!this.isPlaying) {
          return;
        }
        const atEnd = index >= this.manifest.chunking.count - 1
          || this.getCurrentTime() >= this.manifest.durationSec - 0.05;
        if (atEnd) {
          this.isPlaying = false;
          this.pausedAt = 0;
          this._stopTimeTicker();
          this._stopAllSources();
          this.decodedChunks.clear();
          this._emit('ended');
          this._emit('timeupdate', {
            currentTime: 0,
            duration: this.getDuration(),
          });
        }
      };

      return index;
    } 
    catch (error) {
      this._emit('error', { message: String(error) });
      return null;
    }
  }

  _removeSource(source) {
    const idx = this.activeSources.indexOf(source);
    if (idx >= 0) {
      this.activeSources.splice(idx, 1);
    }
  }

  _stopAllSources() {
    for (const source of this.activeSources) {
      try {
        source.onended = null;
        source.stop();
        source.disconnect();
      } catch {
        // ignore already stopped
      }
    }
    this.activeSources = [];
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
    const codec = this.manifest?.encode?.codec || 'unknown';
    const canUseWebCodecs = await this._canUseWebCodecs(codec);
    if (canUseWebCodecs) {
      try {
        const decoded = await this._decodeWithWebCodecs(bytes, codec);
        this.decoderType = 'webcodecs';
        return decoded;
      } catch (err) {
        this._emit('decoderwarning', { decoder: 'webcodecs', message: String(err) });
      }
    }

    const cloned = bytes.slice(0);
    const decoded = await this.ctx.decodeAudioData(cloned);
    this.decoderType = 'decodeAudioData';
    return decoded;
  }

  async _canUseWebCodecs(codec) {
    if (!globalThis.AudioDecoder || !globalThis.EncodedAudioChunk) {
      return false;
    }
    if (!codec || codec === 'unknown' || codec === 'wav' || codec === 'ogg') {
      return false;
    }
    try {
      const result = await AudioDecoder.isConfigSupported({
        codec,
        sampleRate: 48000,
        numberOfChannels: 2,
      });
      return Boolean(result?.supported);
    } catch {
      return false;
    }
  }

  async _decodeWithWebCodecs(bytes, codec) {
    const frames = [];
    let sampleRate = 0;
    let numberOfChannels = 0;
    let totalFrames = 0;

    const decoder = new AudioDecoder({
      output: (audioData) => {
        sampleRate = audioData.sampleRate;
        numberOfChannels = audioData.numberOfChannels;
        const channels = [];
        for (let channelIndex = 0; channelIndex < audioData.numberOfChannels; channelIndex += 1) {
          const channelData = new Float32Array(audioData.numberOfFrames);
          audioData.copyTo(channelData, { planeIndex: channelIndex });
          channels.push(channelData);
        }
        frames.push({
          channels,
          numberOfFrames: audioData.numberOfFrames,
        });
        totalFrames += audioData.numberOfFrames;
        audioData.close();
      },
      error: (error) => {
        this._emit('decoderwarning', { decoder: 'webcodecs', message: String(error) });
      },
    });

    decoder.configure({
      codec,
      sampleRate: 48000,
      numberOfChannels: 2,
    });

    decoder.decode(new EncodedAudioChunk({
      type: 'key',
      timestamp: 0,
      data: new Uint8Array(bytes),
    }));
    await decoder.flush();
    decoder.close();

    if (!frames.length || !sampleRate || !numberOfChannels || !totalFrames) {
      throw new Error('WebCodecs decode produced no frames.');
    }

    const buffer = this.ctx.createBuffer(numberOfChannels, totalFrames, sampleRate);
    let offset = 0;
    for (const frame of frames) {
      for (let channelIndex = 0; channelIndex < numberOfChannels; channelIndex += 1) {
        buffer.getChannelData(channelIndex).set(frame.channels[channelIndex], offset);
      }
      offset += frame.numberOfFrames;
    }
    return buffer;
  }

  _openAudioContext() {
    this.ctx = new AudioContext();
    this.gainNode = this.ctx.createGain();
    this.gainNode.connect(this.ctx.destination);
    this._syncGain();
  }

  _syncGain() {
    if (!this.gainNode) {
      return;
    }
    this.gainNode.gain.value = this.muted ? 0 : this.volume;
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

  _emitStreamStatus(phase, status, extra = {}) {
    this._emit('streamstatus', { phase, status, ...extra });
  }
}

window.StreamingAudioEngine = StreamingAudioEngine;
