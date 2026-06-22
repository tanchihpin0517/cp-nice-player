/**
 * Option B scheduler: main-thread PCM ring + AudioWorklet pull playback.
 */
class WorkletScheduler {
  constructor(options = {}) {
    this.workletModuleUrl = options.workletModuleUrl ?? '../pcmWorkletProcessor.js';
    this.ringCapacitySec = options.ringCapacitySec ?? 10;
    this.ctx = null;
    this.workletNode = null;
    this.gainNode = null;
    this.ring = null;
    this.channelCount = 0;
    this.sampleRate = 0;
    this.initialized = false;
    this.framesAvailable = 0;
    this.capacityFrames = 0;
    this.freeFrames = 0;
    this.underrunFrames = 0;
    this.onStats = options.onStats ?? null;
    this._writeAckWaiters = [];
  }

  async _loadWorkletModule(ctx, moduleUrl) {
    const response = await fetch(moduleUrl);
    if (!response.ok) {
      throw new Error(`Worklet fetch failed (${response.status}) for ${moduleUrl}`);
    }

    const source = await response.text();
    const blob = new Blob([source], { type: 'application/javascript' });
    const blobUrl = URL.createObjectURL(blob);
    try {
      await ctx.audioWorklet.addModule(blobUrl);
    } finally {
      URL.revokeObjectURL(blobUrl);
    }
  }

  async init(ctx, channelCount, sampleRate, options = {}) {
    if (options.ringCapacitySec != null) {
      this.ringCapacitySec = options.ringCapacitySec;
    }

    this.ctx = ctx;
    this.channelCount = channelCount;
    this.sampleRate = sampleRate;
    this.ring = new PcmRing(channelCount, sampleRate, this.ringCapacitySec);

    if (!this.initialized) {
      await this._loadWorkletModule(ctx, this.workletModuleUrl);
      this.initialized = true;
    }

    if (this.workletNode) {
      this.workletNode.disconnect();
      this.workletNode.port.onmessage = null;
    }

    const capacityFrames = this.ring.capacityFrames;
    this.capacityFrames = capacityFrames;
    this.workletNode = new AudioWorkletNode(ctx, 'pcm-worklet-processor', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [channelCount],
      processorOptions: {
        channelCount,
        capacityFrames,
      },
    });

    this.workletNode.port.onmessage = (event) => {
      const msg = event.data;
      if (!msg || typeof msg.type !== 'string') {
        return;
      }

      if (msg.framesAvailable != null) {
        this.framesAvailable = msg.framesAvailable;
      }
      if (msg.capacityFrames != null) {
        this.capacityFrames = msg.capacityFrames;
      }
      if (msg.freeFrames != null) {
        this.freeFrames = msg.freeFrames;
      } else {
        this.freeFrames = this.capacityFrames - this.framesAvailable;
      }
      if (msg.underrunFrames != null) {
        this.underrunFrames = msg.underrunFrames;
      }

      if (msg.type === 'stats') {
        this.onStats?.(msg);
      }

      if (msg.type === 'writeAck') {
        const waiters = this._writeAckWaiters.splice(0);
        for (const resolve of waiters) {
          resolve(msg);
        }
      }
    };

    if (!this.gainNode) {
      this.gainNode = ctx.createGain();
      this.gainNode.connect(ctx.destination);
    }

    this.workletNode.connect(this.gainNode);
  }

  reset() {
    this.ring?.reset();
    this.framesAvailable = 0;
    this.freeFrames = this.capacityFrames;
    this.underrunFrames = 0;
    this.workletNode?.port.postMessage({ type: 'reset' });
  }

  _waitForWriteAck() {
    return new Promise((resolve) => {
      this._writeAckWaiters.push(resolve);
    });
  }

  async _waitForFreeFrames(minFrames) {
    while (this.freeFrames < minFrames) {
      await new Promise((resolve) => setTimeout(resolve, 16));
    }
  }

  /**
   * Copy PCM from an AudioBuffer slice into the worklet ring, waiting when full.
   * @returns {number} frames written
   */
  async writePcm(audioBuffer, offsetFrames, frameCount) {
    let remaining = Math.min(
      frameCount,
      audioBuffer.length - offsetFrames,
    );
    if (remaining <= 0) {
      return 0;
    }

    let totalWritten = 0;
    let offset = offsetFrames;

    while (remaining > 0) {
      await this._waitForFreeFrames(1);

      const chunkFrames = Math.min(remaining, this.freeFrames);
      if (chunkFrames <= 0) {
        continue;
      }

      const channels = [];
      for (let ch = 0; ch < this.channelCount; ch += 1) {
        const data = audioBuffer.getChannelData(ch);
        channels.push(data.subarray(offset, offset + chunkFrames));
      }

      this.workletNode.port.postMessage({
        type: 'writeBlock',
        channels,
      });

      const ack = await this._waitForWriteAck();
      const accepted = ack.accepted ?? 0;
      if (accepted <= 0) {
        break;
      }

      totalWritten += accepted;
      offset += accepted;
      remaining -= accepted;
    }

    return totalWritten;
  }

  async play() {
    if (this.ctx.state !== 'running') {
      await this.ctx.resume();
    }
  }

  async pause() {
    if (this.ctx.state === 'running') {
      await this.ctx.suspend();
    }
  }

  setVolume(value) {
    if (this.gainNode) {
      this.gainNode.gain.value = value;
    }
  }

  dispose() {
    this.workletNode?.disconnect();
    this.workletNode = null;
    this.gainNode?.disconnect();
    this.gainNode = null;
    this.ring = null;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { WorkletScheduler };
}
