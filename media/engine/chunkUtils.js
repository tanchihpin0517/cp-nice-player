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

const PEAKS_PER_CHUNK = 16;

/**
 * Amplitude envelope for one decoded chunk: the largest magnitude across all
 * channels in each of `buckets` equal slices of `frameCount`.
 *
 * The waveform overview is built from these as chunks decode, so the player
 * never reads the source a second time just to draw it. Called once per chunk on
 * PCM that is already in memory, which is a rounding error next to the decode
 * that produced it.
 */
function computeChunkPeaks(planar, frameCount, buckets = PEAKS_PER_CHUNK) {
  const peaks = new Float32Array(buckets);
  const frames = Math.max(0, Math.min(frameCount, planar[0]?.length ?? 0));
  if (frames === 0) {
    return peaks;
  }

  for (let bucket = 0; bucket < buckets; bucket += 1) {
    const from = Math.floor((bucket * frames) / buckets);
    const to = Math.max(from + 1, Math.floor(((bucket + 1) * frames) / buckets));
    let peak = 0;
    for (const channel of planar) {
      for (let i = from; i < to && i < channel.length; i += 1) {
        const magnitude = Math.abs(channel[i]);
        if (magnitude > peak) {
          peak = magnitude;
        }
      }
    }
    peaks[bucket] = Math.min(1, peak);
  }

  return peaks;
}

if (typeof window !== 'undefined') {
  window.chunkIndexForTime = chunkIndexForTime;
  window.chunkEntry = chunkEntry;
  window.formatChunkRanges = formatChunkRanges;
  window.computeChunkPeaks = computeChunkPeaks;
  window.PEAKS_PER_CHUNK = PEAKS_PER_CHUNK;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    chunkIndexForTime,
    chunkEntry,
    formatChunkRanges,
    computeChunkPeaks,
    PEAKS_PER_CHUNK,
  };
}
