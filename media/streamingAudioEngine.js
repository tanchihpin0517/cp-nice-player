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
    this.loadGeneration = 0;
    this.fetchAbort = null;
    this.decodedChunks = new Map();
    this.chunkInFlight = new Map();
    this.scheduledChunks = new Set();
    this.activeSources = [];
    this.nextPlayTime = 0;
    this.pausedAt = 0;
    this.playbackAnchorCtxTime = 0;
    this.isPlaying = false;
    this.volume = 1;
    this.muted = false;
    this.decoderType = 'none';
    this._timeUpdateTimer = null;
    this._buffering = false;
  }

  async load(serverUrl, audioId, options = {}) {
    await this.close({ keepContext: true });
    this.loadGeneration += 1;
    const generation = this.loadGeneration;
    this.serverUrl = serverUrl;
    this.audioId = audioId;
    this.mediaName = options.name || '';
    this.chunkBufferCount = Math.max(1, Number(options.chunkBufferCount) || 5);
    this.pausedAt = 0;
    this.decoderType = 'none';

    this._emit('loading', { serverUrl, audioId });
    this._emitStreamStatus('index', 'started');

    try {
      const manifest = await this._fetchIndex(generation);
      if (generation !== this.loadGeneration) {
        return;
      }
      this.manifest = manifest;
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

      await this._fillWindow(0, this.chunkBufferCount, generation);
    } catch (error) {
      if (generation !== this.loadGeneration) {
        return;
      }
      this._emitStreamStatus('index', 'failed', { detail: String(error) });
      this._emit('error', { message: String(error) });
      throw error;
    }
  }

  async play() {
    if (!this.manifest || this.isPlaying) {
      return;
    }

    const ctx = this._ensureContext();
    if (ctx.state !== 'running') {
      await ctx.resume();
    }

    const chunkIdx = chunkIndexForTime(this.manifest, this.pausedAt);
    await this._ensureChunksForPlayback(chunkIdx);

    this.isPlaying = true;
    this.playbackAnchorCtxTime = ctx.currentTime;
    this.nextPlayTime = ctx.currentTime;
    this._scheduleNextDecoded();
    this._startTicker();
    this._emit('playing');
  }

  async pause() {
    if (!this.isPlaying) {
      return;
    }
    this.pausedAt = this.getCurrentTime();
    this.isPlaying = false;
    this._stopAllSources();
    this.scheduledChunks.clear();
    this._stopTicker();
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
    const generation = this.loadGeneration;
    this._abortFetches();
    this._stopAllSources();
    this.scheduledChunks.clear();
    this.pausedAt = clamped;
    this.isPlaying = false;
    this._stopTicker();

    const chunkIdx = chunkIndexForTime(this.manifest, clamped);
    await this._fillWindow(chunkIdx, this.chunkBufferCount, generation);
    if (generation !== this.loadGeneration) {
      return;
    }

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
    if (!this.isPlaying || !this.ctx) {
      return this.pausedAt;
    }
    const elapsed = this.ctx.currentTime - this.playbackAnchorCtxTime;
    return Math.min(Math.max(this.pausedAt + elapsed, 0), this.manifest.durationSec);
  }

  getDuration() {
    return this.manifest?.durationSec ?? 0;
  }

  getDiagnostics() {
    const decoded = [...this.decodedChunks.keys()].sort((a, b) => a - b);
    const currentChunk = this.manifest ? chunkIndexForTime(this.manifest, this.getCurrentTime()) : 0;
    return {
      mode: 'streaming',
      contextState: this.ctx?.state ?? 'uninitialized',
      sampleRate: this.ctx?.sampleRate ?? 0,
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
      currentChunkIndex: currentChunk,
      decodedChunkIndices: decoded,
      scheduledChunkIndices: [...this.scheduledChunks].sort((a, b) => a - b),
      nextPlayTime: this.nextPlayTime,
      manifestStrategy: this.manifest?.chunking?.strategy,
      manifestChunkCount: this.manifest?.chunking?.count,
      buffering: this._buffering,
    };
  }

  async close(options = {}) {
    this.loadGeneration += 1;
    this._abortFetches();
    await this.pause();
    this.manifest = null;
    this.decodedChunks.clear();
    this.chunkInFlight.clear();
    this.scheduledChunks.clear();
    this.serverUrl = '';
    this.audioId = '';
    if (!options.keepContext && this.ctx) {
      await this.ctx.close();
      this.ctx = null;
      this.gainNode = null;
    }
  }

  _streamQuery() {
    return 'audioId=' + encodeURIComponent(this.audioId);
  }

  async _fetchIndex(generation) {
    const response = await fetch(this.serverUrl + '/index?' + this._streamQuery(), {
      signal: this._createFetchSignal(),
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

  async _fetchAndDecodeChunk(index, generation) {
    if (this.decodedChunks.has(index)) {
      return this.decodedChunks.get(index);
    }
    const inFlight = this.chunkInFlight.get(index);
    if (inFlight) {
      return inFlight;
    }

    const task = (async () => {
      this._emitStreamStatus('chunk', 'started', { chunkIndex: index });
      const response = await fetch(
        this.serverUrl + '/chunk/' + index + '?' + this._streamQuery(),
        { signal: this._createFetchSignal() },
      );
      if (generation !== this.loadGeneration) {
        throw new DOMException('Aborted', 'AbortError');
      }
      if (!response.ok) {
        const body = await response.text();
        throw new Error('chunk ' + index + ' ' + response.status + ': ' + body);
      }

      const bytes = await response.arrayBuffer();
      const entry = chunkEntry(this.manifest, index);
      const audioBuffer = await this._decodeChunk(bytes);
      const decoded = {
        index,
        audioBuffer,
        startSec: entry?.startSec ?? 0,
        endSec: entry?.endSec ?? audioBuffer.duration,
      };
      this.decodedChunks.set(index, decoded);
      this._evictOldChunks(chunkIndexForTime(this.manifest, this.getCurrentTime()));
      this._emitStreamStatus('chunk', 'ready', {
        chunkIndex: index,
        cache: response.headers.get('X-Cache') || 'unknown',
        bytes: bytes.byteLength,
      });

      if (this.isPlaying) {
        this._scheduleNextDecoded();
      }
      return decoded;
    })().finally(() => {
      this.chunkInFlight.delete(index);
    });

    this.chunkInFlight.set(index, task);
    return task;
  }

  async _fillWindow(startIndex, count, generation) {
    if (!this.manifest || generation !== this.loadGeneration) {
      return;
    }
    const maxChunk = this.manifest.chunking.count - 1;
    const start = Math.min(Math.max(0, startIndex), maxChunk);
    const end = Math.min(start + count - 1, maxChunk);
    this._buffering = true;

    try {
      for (let index = start; index <= end; index += 1) {
        if (generation !== this.loadGeneration) {
          return;
        }
        await this._fetchAndDecodeChunk(index, generation);
      }
    } finally {
      if (generation === this.loadGeneration) {
        this._buffering = false;
      }
    }
  }

  async _ensureChunksForPlayback(startChunkIndex) {
    const generation = this.loadGeneration;
    await this._fillWindow(startChunkIndex, this.chunkBufferCount, generation);
    if (!this.decodedChunks.has(startChunkIndex)) {
      throw new Error('Failed to buffer chunk ' + startChunkIndex);
    }
  }

  async _topUpBuffer() {
    if (!this.manifest || !this.isPlaying) {
      return;
    }
    const generation = this.loadGeneration;
    const currentChunk = chunkIndexForTime(this.manifest, this.getCurrentTime());
    const targetEnd = Math.min(
      currentChunk + this.chunkBufferCount - 1,
      this.manifest.chunking.count - 1,
    );

    let highestDecoded = -1;
    for (const index of this.decodedChunks.keys()) {
      highestDecoded = Math.max(highestDecoded, index);
    }

    if (highestDecoded >= targetEnd) {
      return;
    }

    const fillStart = Math.max(highestDecoded + 1, currentChunk);
    const fillCount = targetEnd - fillStart + 1;
    if (fillCount > 0) {
      await this._fillWindow(fillStart, fillCount, generation);
    }
  }

  _nextChunkToSchedule() {
    if (this.scheduledChunks.size === 0) {
      return chunkIndexForTime(this.manifest, this.pausedAt);
    }
    return Math.max(...this.scheduledChunks) + 1;
  }

  _scheduleNextDecoded(firstOffsetSec = 0) {
    if (!this.manifest || !this.isPlaying) {
      return;
    }
    const nextIndex = this._nextChunkToSchedule();
    if (!this.decodedChunks.has(nextIndex)) {
      return;
    }
    const offset = this.scheduledChunks.size === 0
      ? Math.max(0, this.pausedAt - chunkEntry(this.manifest, nextIndex).startSec)
      : 0;
    this._scheduleFromIndex(nextIndex, firstOffsetSec || offset);
  }

  _scheduleFromIndex(startIndex, firstOffsetSec) {
    if (!this.manifest || !this.isPlaying || !this.ctx) {
      return;
    }

    const ctx = this.ctx;
    if (this.nextPlayTime < ctx.currentTime) {
      this.nextPlayTime = ctx.currentTime;
    }

    const maxChunk = this.manifest.chunking.count - 1;
    let scheduleTime = this.nextPlayTime;
    let isFirst = true;

    for (let index = startIndex; index <= maxChunk; index += 1) {
      if (this.scheduledChunks.has(index)) {
        isFirst = false;
        continue;
      }

      const decoded = this.decodedChunks.get(index);
      if (!decoded) {
        break;
      }

      const offsetSec = isFirst ? Math.min(firstOffsetSec, decoded.audioBuffer.duration) : 0;
      const playDuration = Math.max(0, decoded.audioBuffer.duration - offsetSec);
      if (playDuration <= 0) {
        isFirst = false;
        continue;
      }

      const source = ctx.createBufferSource();
      source.buffer = decoded.audioBuffer;
      source.connect(this._ensureGainNode());
      source.start(scheduleTime, offsetSec);
      this.activeSources.push(source);
      this.scheduledChunks.add(index);

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
          this.scheduledChunks.clear();
          this._stopTicker();
          this._emit('ended');
          this._emit('timeupdate', {
            currentTime: 0,
            duration: this.getDuration(),
          });
        }
      };

      scheduleTime += playDuration;
      isFirst = false;
    }

    this.nextPlayTime = scheduleTime;
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

  _evictOldChunks(currentChunkIndex) {
    const keepFrom = currentChunkIndex - 2;
    for (const index of [...this.decodedChunks.keys()]) {
      if (index < keepFrom && !this.scheduledChunks.has(index)) {
        this.decodedChunks.delete(index);
      }
    }
  }

  _abortFetches() {
    this.fetchAbort?.abort();
    this.fetchAbort = null;
  }

  _createFetchSignal() {
    this._abortFetches();
    this.fetchAbort = new AbortController();
    return this.fetchAbort.signal;
  }

  async _decodeChunk(bytes) {
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

    const ctx = this._ensureContext();
    const cloned = bytes.slice(0);
    const decoded = await ctx.decodeAudioData(cloned);
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
    const ctx = this._ensureContext();
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

    const buffer = ctx.createBuffer(numberOfChannels, totalFrames, sampleRate);
    let offset = 0;
    for (const frame of frames) {
      for (let channelIndex = 0; channelIndex < numberOfChannels; channelIndex += 1) {
        buffer.getChannelData(channelIndex).set(frame.channels[channelIndex], offset);
      }
      offset += frame.numberOfFrames;
    }
    return buffer;
  }

  _ensureContext() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this._ensureGainNode();
    }
    return this.ctx;
  }

  _ensureGainNode() {
    if (!this.gainNode) {
      this.gainNode = this._ensureContext().createGain();
      this.gainNode.connect(this.ctx.destination);
      this._syncGain();
    }
    return this.gainNode;
  }

  _syncGain() {
    if (!this.gainNode) {
      return;
    }
    this.gainNode.gain.value = this.muted ? 0 : this.volume;
  }

  _startTicker() {
    this._stopTicker();
    this._timeUpdateTimer = setInterval(() => {
      if (!this.manifest) {
        return;
      }
      const currentTime = this.getCurrentTime();
      this._emit('timeupdate', {
        currentTime,
        duration: this.getDuration(),
      });
      void this._topUpBuffer().then(() => {
        if (this.isPlaying) {
          this._scheduleNextDecoded();
        }
      }).catch((error) => {
        this._emit('error', { message: String(error) });
      });
      this._evictOldChunks(chunkIndexForTime(this.manifest, currentTime));
    }, 200);
  }

  _stopTicker() {
    if (this._timeUpdateTimer) {
      clearInterval(this._timeUpdateTimer);
      this._timeUpdateTimer = null;
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
