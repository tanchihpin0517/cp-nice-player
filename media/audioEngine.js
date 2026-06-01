class AudioEngine extends EventTarget {
  constructor() {
    super();
    this.ctx = null;
    this.gainNode = null;
    this.audioBuffer = null;
    this.currentSource = null;
    this.abortController = null;
    this.playbackStartAt = 0;
    this.pausedAt = 0;
    this.isPlaying = false;
    this.volume = 1;
    this.muted = false;
    this.decoderType = 'none';
    this.codec = 'unknown';
    this.mediaName = '';
    this.sourceUrl = '';
    this._timeUpdateTimer = null;
  }

  async load(url, options = {}) {
    await this.stop();
    this.abortController?.abort();
    this.abortController = new AbortController();
    this.codec = options.codec || 'unknown';
    this.mediaName = options.name || '';
    this.sourceUrl = url;
    this.decoderType = 'none';
    this.pausedAt = 0;

    this._emit('loading', { url, codec: this.codec });
    const response = await fetch(url, { signal: this.abortController.signal });
    if (!response.ok) {
      throw new Error(`Failed to fetch audio (${response.status})`);
    }

    const bytes = await response.arrayBuffer();
    this.audioBuffer = await this._decodeFull(bytes, this.codec);
    this.pausedAt = 0;
    this._emit('ready', {
      duration: this.audioBuffer.duration,
      decoderType: this.decoderType,
      codec: this.codec,
    });
    this._emit('timeupdate', { currentTime: 0, duration: this.audioBuffer.duration });
  }

  async play() {
    if (!this.audioBuffer || this.isPlaying) {
      return;
    }

    const ctx = this._ensureContext();
    if (ctx.state !== 'running') {
      await ctx.resume();
    }

    this.currentSource = ctx.createBufferSource();
    this.currentSource.buffer = this.audioBuffer;
    this.currentSource.connect(this._ensureGainNode());
    this.playbackStartAt = ctx.currentTime - this.pausedAt;
    this.currentSource.start(0, this.pausedAt);
    this.isPlaying = true;

    this.currentSource.onended = () => {
      if (!this.isPlaying) {
        return;
      }
      const now = this.getCurrentTime();
      if (this.audioBuffer && now >= this.audioBuffer.duration - 0.02) {
        this.isPlaying = false;
        this.pausedAt = 0;
        this.currentSource = null;
        this._stopTicker();
        this._emit('ended');
        this._emit('timeupdate', { currentTime: 0, duration: this.audioBuffer.duration });
      }
    };

    this._startTicker();
    this._emit('playing');
  }

  async pause() {
    if (!this.isPlaying) {
      return;
    }
    this.pausedAt = this.getCurrentTime();
    this.isPlaying = false;
    if (this.currentSource) {
      this.currentSource.onended = null;
      this.currentSource.stop();
      this.currentSource.disconnect();
      this.currentSource = null;
    }
    this._stopTicker();
    this._emit('pause');
    this._emit('timeupdate', { currentTime: this.pausedAt, duration: this.getDuration() });
  }

  async stop() {
    await this.pause();
    this.pausedAt = 0;
    this._emit('timeupdate', { currentTime: 0, duration: this.getDuration() });
  }

  async seek(seconds) {
    const duration = this.getDuration();
    const clamped = Math.min(Math.max(seconds, 0), Number.isFinite(duration) ? duration : 0);
    const wasPlaying = this.isPlaying;
    if (wasPlaying) {
      await this.pause();
    }
    this.pausedAt = clamped;
    this._emit('timeupdate', { currentTime: this.pausedAt, duration: this.getDuration() });
    if (wasPlaying) {
      await this.play();
    }
  }

  setVolume(volume) {
    const normalized = Math.min(Math.max(Number(volume) || 0, 0), 1);
    this.volume = normalized;
    this._syncGain();
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
    this._syncGain();
  }

  getCurrentTime() {
    if (!this.audioBuffer) {
      return 0;
    }
    if (!this.isPlaying || !this.ctx) {
      return this.pausedAt;
    }
    return Math.min(Math.max(this.ctx.currentTime - this.playbackStartAt, 0), this.audioBuffer.duration);
  }

  getDuration() {
    return this.audioBuffer?.duration ?? 0;
  }

  getDiagnostics() {
    return {
      mode: 'webAudio',
      contextState: this.ctx?.state ?? 'uninitialized',
      sampleRate: this.ctx?.sampleRate ?? this.audioBuffer?.sampleRate ?? 0,
      currentTime: this.getCurrentTime(),
      duration: this.getDuration(),
      paused: !this.isPlaying,
      muted: this.muted,
      volume: this.volume,
      codec: this.codec,
      decoderType: this.decoderType,
      sourceUrl: this.sourceUrl,
      mediaName: this.mediaName,
    };
  }

  async close() {
    await this.stop();
    this.abortController?.abort();
    this.abortController = null;
    this.audioBuffer = null;
    if (this.ctx) {
      await this.ctx.close();
      this.ctx = null;
      this.gainNode = null;
    }
  }

  async _decodeFull(bytes, codec) {
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
        for (let channelIndex = 0; channelIndex < audioData.numberOfChannels; channelIndex++) {
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
      for (let channelIndex = 0; channelIndex < numberOfChannels; channelIndex++) {
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
      this._emit('timeupdate', {
        currentTime: this.getCurrentTime(),
        duration: this.getDuration(),
      });
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
}

window.AudioEngine = AudioEngine;
