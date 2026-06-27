/**
 * AudioWorklet processor for Option B: pulls PCM from an internal ring buffer
 * fed by the main thread via MessagePort.
 */
class PcmRingReader {
  constructor(channelCount, capacityFrames) {
    this.channelCount = channelCount;
    this.capacityFrames = capacityFrames;
    this.channels = Array.from(
      { length: channelCount },
      () => new Float32Array(capacityFrames),
    );
    this.writeIndex = 0;
    this.readIndex = 0;
    this.framesAvailable = 0;
    this.underrunFrames = 0;
  }

  reset() {
    this.writeIndex = 0;
    this.readIndex = 0;
    this.framesAvailable = 0;
    this.underrunFrames = 0;
  }

  freeFrames() {
    return this.capacityFrames - this.framesAvailable;
  }

  /**
   * Write up to freeFrames() samples; never overwrite unread data.
   * @returns {number} frames accepted
   */
  writeBlock(channelSamples) {
    const frameCount = channelSamples[0]?.length ?? 0;
    if (frameCount <= 0) {
      return 0;
    }

    const toWrite = Math.min(frameCount, this.freeFrames());
    if (toWrite <= 0) {
      return 0;
    }

    let wi = this.writeIndex;
    for (let i = 0; i < toWrite; i += 1) {
      for (let ch = 0; ch < this.channelCount; ch += 1) {
        this.channels[ch][wi] = channelSamples[ch][i];
      }
      wi = (wi + 1) % this.capacityFrames;
    }

    this.writeIndex = wi;
    this.framesAvailable += toWrite;
    return toWrite;
  }

  read(outputChannels, frameCount) {
    if (!outputChannels || outputChannels.length === 0) {
      return;
    }

    const channels = Math.min(outputChannels.length, this.channelCount);
    let underrun = 0;

    for (let frame = 0; frame < frameCount; frame += 1) {
      if (this.framesAvailable <= 0) {
        for (let ch = 0; ch < channels; ch += 1) {
          outputChannels[ch][frame] = 0;
        }
        underrun += 1;
        continue;
      }

      for (let ch = 0; ch < channels; ch += 1) {
        outputChannels[ch][frame] = this.channels[ch][this.readIndex];
      }
      this.readIndex = (this.readIndex + 1) % this.capacityFrames;
      this.framesAvailable -= 1;
    }

    if (underrun > 0) {
      this.underrunFrames += underrun;
    }
  }

  stats() {
    return {
      framesAvailable: this.framesAvailable,
      capacityFrames: this.capacityFrames,
      freeFrames: this.freeFrames(),
      underrunFrames: this.underrunFrames,
    };
  }
}

class PcmWorkletProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const channelCount = options.processorOptions?.channelCount ?? 2;
    const capacityFrames = options.processorOptions?.capacityFrames ?? 480000;
    this.ring = new PcmRingReader(channelCount, capacityFrames);
    this.reportIntervalFrames = options.processorOptions?.reportIntervalFrames ?? 48000;
    this.framesSinceReport = 0;

    this.port.onmessage = (event) => {
      const msg = event.data;
      if (!msg || typeof msg.type !== 'string') {
        return;
      }

      switch (msg.type) {
        case 'reset':
          this.ring.reset();
          this.port.postMessage({ type: 'stats', ...this.ring.stats() });
          break;
        case 'writeBlock': {
          const requested = msg.channels?.[0]?.length ?? 0;
          const accepted = this.ring.writeBlock(msg.channels);
          this.port.postMessage({
            type: 'writeAck',
            requested,
            accepted,
            ...this.ring.stats(),
          });
          break;
        }
        default:
          break;
      }
    };
  }

  process(inputs, outputs) {
    const output = outputs[0];
    if (!output || output.length === 0) {
      return true;
    }

    const frameCount = output[0].length;
    this.ring.read(output, frameCount);

    this.framesSinceReport += frameCount;
    if (this.framesSinceReport >= this.reportIntervalFrames) {
      this.port.postMessage({ type: 'stats', ...this.ring.stats() });
      this.framesSinceReport = 0;
    }

    return true;
  }
}

registerProcessor('pcm-worklet-processor', PcmWorkletProcessor);
