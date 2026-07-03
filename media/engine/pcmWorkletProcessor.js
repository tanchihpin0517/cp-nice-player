/**
 * AudioWorklet processor for Option B: pulls PCM from an internal ring buffer
 * fed by the main thread via MessagePort.
 *
 * PcmRingReader is loaded from pcmRingReader.js before this file in the worklet bundle.
 */
const STATS_REPORT_HZ = 20;
const STATS_REPORT_INTERVAL_SEC = 1 / STATS_REPORT_HZ;

class PcmWorkletProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const channelCount = options.processorOptions?.channelCount ?? 2;
    const capacityFrames = options.processorOptions?.capacityFrames ?? 480000;
    const rate = options.processorOptions?.sampleRate ?? sampleRate;
    this.ring = new PcmRingReader(channelCount, capacityFrames);
    this.reportIntervalFrames = Math.max(
      1,
      Math.round(rate * STATS_REPORT_INTERVAL_SEC),
    );
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
