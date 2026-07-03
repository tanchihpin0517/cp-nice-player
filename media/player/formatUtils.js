function formatTime(seconds) {
  if (!Number.isFinite(seconds)) {
    return '—';
  }
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return mins + ':' + String(secs).padStart(2, '0');
}

function formatChunkBytes(bytes) {
  if (bytes < 1024) {
    return bytes + 'B';
  }
  if (bytes < 1024 * 1024) {
    return (bytes / 1024).toFixed(1) + 'KB';
  }
  return (bytes / (1024 * 1024)).toFixed(1) + 'MB';
}

function formatAudioLayout(diag) {
  const channels = diag.manifestChannels;
  const manifestRate = diag.manifestSampleRate;
  const contextRate = diag.contextSampleRate;
  if (!channels || !manifestRate) {
    return '—';
  }
  let layout = channels + 'ch @ ' + manifestRate + ' Hz';
  if (contextRate && contextRate !== manifestRate) {
    layout += ' (ctx ' + contextRate + ' Hz)';
  }
  return layout;
}

function formatWsolaShift(samples, sampleRate) {
  if (samples == null || !sampleRate) {
    return '—';
  }
  const ms = (samples / sampleRate) * 1000;
  return ms.toFixed(1) + 'ms(' + samples + ')';
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

if (typeof window !== 'undefined') {
  window.formatTime = formatTime;
  window.formatChunkBytes = formatChunkBytes;
  window.formatAudioLayout = formatAudioLayout;
  window.formatWsolaShift = formatWsolaShift;
  window.escapeHtml = escapeHtml;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    formatTime,
    formatChunkBytes,
    formatAudioLayout,
    formatWsolaShift,
    escapeHtml,
  };
}
