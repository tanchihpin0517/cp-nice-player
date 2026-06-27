/**
 * Per-channel circular PCM buffer for Option B scheduling.
 * Main thread writes decoded samples; the worklet maintains its own read-side copy via messages.
 */
class PcmRing {
  /**
   * @param {number} channelCount
   * @param {number} sampleRate
   * @param {number} capacitySec - ring duration in seconds (default 10)
   */
  constructor(channelCount, sampleRate, capacitySec = 10) {
    this.channelCount = channelCount;
    this.sampleRate = sampleRate;
    this.capacityFrames = Math.max(1, Math.ceil(sampleRate * capacitySec));
    this.channels = Array.from(
      { length: channelCount },
      () => new Float32Array(this.capacityFrames),
    );
    this.writeIndex = 0;
    this.framesWritten = 0;
  }

  reset() {
    this.writeIndex = 0;
    this.framesWritten = 0;
  }

  /** Frames currently in the ring (capped at capacity). */
  availableFrames() {
    return Math.min(this.framesWritten, this.capacityFrames);
  }

  /**
   * Write interleaved channel data starting at offsetFrames in the source buffer.
   * @param {AudioBuffer} audioBuffer
   * @param {number} offsetFrames
   * @param {number} frameCount
   */
  writeFromAudioBuffer(audioBuffer, offsetFrames, frameCount) {
    const count = Math.min(
      frameCount,
      audioBuffer.length - offsetFrames,
    );
    if (count <= 0) {
      return 0;
    }

    for (let ch = 0; ch < this.channelCount; ch += 1) {
      const src = audioBuffer.getChannelData(ch);
      const dst = this.channels[ch];
      let wi = this.writeIndex;
      for (let i = 0; i < count; i += 1) {
        dst[wi] = src[offsetFrames + i];
        wi = (wi + 1) % this.capacityFrames;
      }
    }

    this.writeIndex = (this.writeIndex + count) % this.capacityFrames;
    this.framesWritten += count;
    return count;
  }

  /**
   * Copy a contiguous slice from the ring for sending to the worklet.
   * Returns per-channel Float32Array slices (may wrap — caller sends in chunks).
   */
  readChannelSlice(channelIndex, startFrame, frameCount) {
    const dst = new Float32Array(frameCount);
    const src = this.channels[channelIndex];
    const start = startFrame % this.capacityFrames;
    const firstRun = Math.min(frameCount, this.capacityFrames - start);
    dst.set(src.subarray(start, start + firstRun), 0);
    if (firstRun < frameCount) {
      dst.set(src.subarray(0, frameCount - firstRun), firstRun);
    }
    return dst;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PcmRing };
}
