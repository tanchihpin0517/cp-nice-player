function audioBufferToPlanar(audioBuffer) {
  const planar = [];
  for (let ch = 0; ch < audioBuffer.numberOfChannels; ch += 1) {
    planar.push(audioBuffer.getChannelData(ch));
  }
  return planar;
}

function buildLinearFade(overlapFrames) {
  const fadeIn = new Float32Array(overlapFrames);
  const fadeOut = new Float32Array(overlapFrames);
  for (let i = 0; i < overlapFrames; i += 1) {
    const t = (i + 0.5) / overlapFrames;
    fadeIn[i] = t;
    fadeOut[i] = 1 - t;
  }
  return { fadeIn, fadeOut };
}

function normalizedCrossCorrelation(tail, head, headStart, blendFrames) {
  let dot = 0;
  let tailEnergy = 0;
  let headEnergy = 0;

  for (let ch = 0; ch < tail.length; ch += 1) {
    const tailCh = tail[ch];
    const headCh = head[ch];
    for (let i = 0; i < blendFrames; i += 1) {
      const t = tailCh[i];
      const h = headCh[headStart + i];
      dot += t * h;
      tailEnergy += t * t;
      headEnergy += h * h;
    }
  }

  const denom = Math.sqrt(tailEnergy * headEnergy);
  if (denom <= 1e-12) {
    return 0;
  }
  return dot / denom;
}

function findWsolaOffset(tail, head, blendFrames, searchRadius, baseOffset = 0) {
  let bestOffset = 0;
  let bestScore = -Infinity;

  for (let offset = -searchRadius; offset <= searchRadius; offset += 1) {
    const headStart = baseOffset + offset;
    if (headStart < 0 || headStart + blendFrames > head[0].length) {
      continue;
    }
    const score = normalizedCrossCorrelation(tail, head, headStart, blendFrames);
    if (score > bestScore) {
      bestScore = score;
      bestOffset = offset;
    }
  }

  return bestOffset;
}

function linearCrossfade(tail, head, headStart, blendFrames, fadeIn, fadeOut) {
  const blended = [];
  for (let ch = 0; ch < tail.length; ch += 1) {
    const out = new Float32Array(blendFrames);
    const tailCh = tail[ch];
    const headCh = head[ch];
    for (let i = 0; i < blendFrames; i += 1) {
      out[i] = tailCh[i] * fadeOut[i] + headCh[headStart + i] * fadeIn[i];
    }
    blended.push(out);
  }
  return blended;
}

if (typeof window !== 'undefined') {
  window.audioBufferToPlanar = audioBufferToPlanar;
  window.buildLinearFade = buildLinearFade;
  window.normalizedCrossCorrelation = normalizedCrossCorrelation;
  window.findWsolaOffset = findWsolaOffset;
  window.linearCrossfade = linearCrossfade;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    audioBufferToPlanar,
    buildLinearFade,
    normalizedCrossCorrelation,
    findWsolaOffset,
    linearCrossfade,
  };
}
