/*
 * DEMO ONLY — not shipped.
 *
 * Stands in for StreamingAudioEngine: same method names, same event names, same
 * getDiagnostics() shape, but no audio and no server. It simulates the parts the
 * UI actually reflects — index load, a sliding chunk window, fetch/decode
 * latency, eviction, underruns, errors — on a fake clock.
 */

/** Matches PEAKS_PER_CHUNK in media/engine/chunkUtils.js. */
const PEAKS_PER_CHUNK = 16;

function formatChunkRanges(indices) {
  if (indices.length === 0) {
    return '';
  }
  const parts = [];
  let start = indices[0];
  let prev = indices[0];
  for (let i = 1; i <= indices.length; i += 1) {
    const value = indices[i];
    if (value !== prev + 1) {
      parts.push(start === prev ? String(start) : start + '-' + prev);
      start = value;
    }
    prev = value;
  }
  return parts.join(', ');
}

/** Deterministic pseudo-random so a track's waveform looks the same every load. */
function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/**
 * Synthetic peak data with song-like structure: quiet intro, verses, louder
 * choruses, a breakdown, and an outro fade — so the waveform revealed by
 * playback looks like music rather than noise.
 */
function generatePeaks(seed, buckets, sections) {
  const random = seededRandom(seed);
  const peaks = new Float32Array(buckets);
  let envelope = 0;

  for (let i = 0; i < buckets; i += 1) {
    const position = i / buckets;
    let target = 0.2;
    for (const section of sections) {
      if (position >= section.from && position < section.to) {
        target = section.level;
        break;
      }
    }
    envelope += (target - envelope) * 0.06;

    const beat = 0.55 + 0.45 * Math.abs(Math.sin(position * buckets * 0.22));
    const noise = 0.7 + random() * 0.5;
    const fadeIn = Math.min(1, position * 40);
    const fadeOut = Math.min(1, (1 - position) * 25);
    peaks[i] = Math.min(1, envelope * beat * noise * fadeIn * fadeOut);
  }
  return peaks;
}

const DEMO_TRACKS = [
  {
    id: 'a1f39c',
    name: 'nocturne-in-e-flat.flac',
    fsPath: '/home/you/music/nocturne-in-e-flat.flac',
    duration: 247.4,
    channels: 2,
    sampleRate: 48000,
    playbackFormat: 'flac',
    seed: 7,
    sections: [
      { from: 0, to: 0.12, level: 0.28 },
      { from: 0.12, to: 0.34, level: 0.55 },
      { from: 0.34, to: 0.52, level: 0.9 },
      { from: 0.52, to: 0.64, level: 0.35 },
      { from: 0.64, to: 0.86, level: 0.95 },
      { from: 0.86, to: 1, level: 0.4 },
    ],
  },
  {
    id: 'b7c210',
    name: 'field-recording-harbour.wav',
    fsPath: '/home/you/audio/field-recording-harbour.wav',
    duration: 92.8,
    channels: 1,
    sampleRate: 44100,
    playbackFormat: 'ogg',
    seed: 21,
    sections: [
      { from: 0, to: 0.3, level: 0.42 },
      { from: 0.3, to: 0.45, level: 0.75 },
      { from: 0.45, to: 0.8, level: 0.38 },
      { from: 0.8, to: 1, level: 0.6 },
    ],
  },
  {
    id: 'c4e881',
    name: 'lecture-2026-04-18-full.m4a',
    fsPath: '/home/you/recordings/lecture-2026-04-18-full.m4a',
    duration: 3742,
    channels: 2,
    sampleRate: 44100,
    playbackFormat: 'ogg',
    seed: 42,
    sections: [
      { from: 0, to: 0.05, level: 0.25 },
      { from: 0.05, to: 0.95, level: 0.62 },
      { from: 0.95, to: 1, level: 0.3 },
    ],
  },
];

class MockEngine extends EventTarget {
  constructor() {
    super();
    this.scenario = { latencyMs: 140, failIndex: false, failChunks: false, jitter: 0.5 };
    this.track = null;
    this.manifest = null;
    this.currentTime = 0;
    this.duration = 0;
    this.isPlaying = false;
    this.volume = 1;
    this.muted = false;
    this.chunkBufferCount = 5;
    this.chunkDurationSec = 1;
    this.maxEncodedChunks = 64;
    this.decoded = new Set();
    this.inflight = new Map();
    this.encoded = new Set();
    this.underrunFrames = 0;
    this.framesAvailable = 0;
    this.contextState = 'uninitialized';
    this._tick = null;
    this._pump = null;
    this._generation = 0;
  }

  // --------------------------------------------------------------- loading

  async load(serverUrl, audioId, options = {}) {
    const generation = ++this._generation;
    this._stopLoops();
    this.track = DEMO_TRACKS.find((t) => t.id === audioId) ?? DEMO_TRACKS[0];
    this.chunkBufferCount = options.chunkBufferCount ?? 5;
    this.chunkDurationSec = options.chunkDurationSec ?? 1;
    this.maxEncodedChunks = options.maxEncodedChunks ?? 64;
    this.currentTime = 0;
    this.decoded.clear();
    this.inflight.clear();
    this.encoded.clear();
    this.underrunFrames = 0;
    this.manifest = null;
    this.trackPeaks = null;
    this.duration = 0;
    this.contextState = 'uninitialized';

    this.dispatchEvent(new CustomEvent('loading'));
    await delay(this.scenario.latencyMs * 3);
    if (generation !== this._generation) {
      return;
    }

    if (this.scenario.failIndex) {
      const message = 'GET ' + serverUrl + '/audio/' + audioId + '/index failed: ECONNREFUSED';
      this.dispatchEvent(new CustomEvent('error', { detail: { message } }));
      throw new Error(message);
    }

    this.duration = this.track.duration;
    this.manifest = {
      sampleRate: this.track.sampleRate,
      channels: this.track.channels,
      chunking: {
        count: Math.ceil(this.track.duration / this.chunkDurationSec),
        crossfadeMs: 20,
      },
    };
    this.contextState = 'suspended';
    this.trackPeaks = this._generateTrackPeaks();
    this.dispatchEvent(new CustomEvent('ready', { detail: { duration: this.duration } }));
    this._startPump();
  }

  /**
   * Stands in for the audio itself. The player never sees this: it only receives
   * the 16 buckets belonging to a chunk, and only once that chunk has decoded —
   * exactly as the real engine reports peaks from PCM it just decoded.
   */
  _generateTrackPeaks() {
    return generatePeaks(
      this.track.seed,
      this.manifest.chunking.count * PEAKS_PER_CHUNK,
      this.track.sections,
    );
  }

  // -------------------------------------------------------------- controls

  async play() {
    if (!this.manifest) {
      return;
    }
    this.contextState = 'running';
    this.isPlaying = true;
    this.dispatchEvent(new CustomEvent('playing'));
    this._startTicker();
  }

  async pause() {
    this.isPlaying = false;
    this.contextState = 'suspended';
    this._stopTicker();
    this.dispatchEvent(new CustomEvent('pause'));
  }

  async seek(seconds) {
    this.currentTime = Math.min(this.duration, Math.max(0, seconds));
    // Real engine aborts in-flight fetches on seek and rebuilds the window.
    this.inflight.clear();
    this.underrunFrames += this.isPlaying ? 512 : 0;
    await delay(this.scenario.latencyMs);
    this.dispatchEvent(new CustomEvent('timeupdate', {
      detail: { currentTime: this.currentTime, duration: this.duration },
    }));
  }

  setVolume(value) {
    this.volume = value;
  }

  setMuted(value) {
    this.muted = value;
  }

  // ----------------------------------------------------------------- loops

  _startTicker() {
    this._stopTicker();
    this._tick = setInterval(() => {
      const step = 0.25;
      this.currentTime = Math.min(this.duration, this.currentTime + step);
      this.framesAvailable = Math.max(0, Math.min(16384, this.framesAvailable + 1800 - 2400));
      if (this.currentTime >= this.duration) {
        this.isPlaying = false;
        this._stopTicker();
        this.dispatchEvent(new CustomEvent('ended'));
        return;
      }
      this.dispatchEvent(new CustomEvent('timeupdate', {
        detail: { currentTime: this.currentTime, duration: this.duration },
      }));
    }, 250);
  }

  _stopTicker() {
    if (this._tick != null) {
      clearInterval(this._tick);
      this._tick = null;
    }
  }

  /** Keeps chunkBufferCount chunks ahead of the playhead fetched and decoded. */
  _startPump() {
    this._stopPump();
    this._pump = setInterval(() => {
      if (!this.manifest) {
        return;
      }
      const total = this.manifest.chunking.count;
      const current = Math.floor(this.currentTime / this.chunkDurationSec);
      const wanted = [];
      for (let i = current; i < Math.min(total, current + this.chunkBufferCount); i += 1) {
        wanted.push(i);
      }

      for (const index of wanted) {
        if (this.decoded.has(index) || this.inflight.has(index)) {
          continue;
        }
        this._fetchChunk(index);
      }

      // Evict what fell behind the window, mirroring the engine's bounded memory.
      for (const index of [...this.decoded]) {
        if (index < current - 2 || index > current + this.chunkBufferCount + 2) {
          this.decoded.delete(index);
        }
      }
      while (this.encoded.size > this.maxEncodedChunks) {
        this.encoded.delete(this.encoded.values().next().value);
      }
      if (this.isPlaying && !this.decoded.has(current)) {
        this.underrunFrames += 128;
      } else {
        this.framesAvailable = Math.min(16384, this.framesAvailable + 2400);
      }
    }, 180);
  }

  _stopPump() {
    if (this._pump != null) {
      clearInterval(this._pump);
      this._pump = null;
    }
  }

  _stopLoops() {
    this._stopTicker();
    this._stopPump();
  }

  _fetchChunk(index) {
    const generation = this._generation;
    const jitter = 1 + (Math.random() - 0.5) * this.scenario.jitter;
    const latency = this.scenario.latencyMs * jitter;
    this.inflight.set(index, true);

    setTimeout(() => {
      if (generation !== this._generation || !this.inflight.has(index)) {
        return;
      }
      this.inflight.delete(index);

      if (this.scenario.failChunks) {
        this.dispatchEvent(new CustomEvent('error', {
          detail: { message: 'chunk ' + index + ' failed: HTTP 500 transcode error' },
        }));
        return;
      }

      const bytes = Math.round(18000 + Math.random() * 26000);
      this.encoded.add(index);
      this.dispatchEvent(new CustomEvent('chunkfinished', { detail: { chunkIndex: index, bytes } }));

      setTimeout(() => {
        if (generation !== this._generation) {
          return;
        }
        this.decoded.add(index);
        this.dispatchEvent(new CustomEvent('decodefinished', {
          detail: {
            chunkIndex: index,
            elapsedMs: 1.5 + Math.random() * 6,
            wsolaShiftSamples: Math.round((Math.random() - 0.5) * 90),
            peaks: this.trackPeaks.slice(index * PEAKS_PER_CHUNK, (index + 1) * PEAKS_PER_CHUNK),
          },
        }));
      }, 20 + Math.random() * 40);
    }, latency);
  }

  // ----------------------------------------------------------- diagnostics

  getCurrentTime() {
    return this.currentTime;
  }

  getDuration() {
    return this.duration;
  }

  getDiagnostics() {
    const decoded = [...this.decoded].sort((a, b) => a - b);
    const inflight = [...this.inflight.keys()].sort((a, b) => a - b);
    return {
      contextState: this.manifest ? this.contextState : 'uninitialized',
      contextSampleRate: this.manifest ? 48000 : 0,
      manifestChannels: this.manifest?.channels ?? 0,
      manifestSampleRate: this.manifest?.sampleRate ?? 0,
      currentTime: this.currentTime,
      duration: this.duration,
      paused: !this.isPlaying,
      muted: this.muted,
      volume: this.volume,
      chunkBufferCount: this.chunkBufferCount,
      maxEncodedChunks: this.maxEncodedChunks,
      encodedChunkCount: this.encoded.size,
      currentChunkIndex: Math.floor(this.currentTime / this.chunkDurationSec),
      fetchInFlight: formatChunkRanges(inflight),
      decodedChunks: formatChunkRanges(decoded),
      bufferedChunks: formatChunkRanges([...this.encoded].sort((a, b) => a - b)),
      ringFramesAvailable: this.manifest ? this.framesAvailable : null,
      ringFreeFrames: this.manifest ? 16384 - this.framesAvailable : null,
      underrunFrames: this.underrunFrames,
      manifestChunkCount: this.manifest?.chunking?.count,
      manifestCrossfadeMs: this.manifest?.chunking?.crossfadeMs,
    };
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

window.MockEngine = MockEngine;
window.DEMO_TRACKS = DEMO_TRACKS;
