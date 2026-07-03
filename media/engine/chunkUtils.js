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

if (typeof window !== 'undefined') {
  window.chunkIndexForTime = chunkIndexForTime;
  window.chunkEntry = chunkEntry;
  window.formatChunkRanges = formatChunkRanges;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { chunkIndexForTime, chunkEntry, formatChunkRanges };
}
