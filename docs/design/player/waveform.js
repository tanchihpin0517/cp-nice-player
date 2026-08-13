/*
 * Waveform overview + buffer rail.
 *
 * Draws two things on one canvas:
 *   1. mirrored peak bars for the whole track, coloured past/future by playhead
 *   2. a thin rail underneath showing which chunks are decoded / in flight / absent
 *
 * Colours are pulled from the stylesheet's custom properties so the canvas
 * follows the active VS Code theme. Call refreshTheme() after a theme change.
 */
class WaveformView {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.peaks = null;
    this.duration = 0;
    this.currentTime = 0;
    this.hoverTime = null;
    this.buffer = { chunkCount: 0, chunkDurationSec: 1, decoded: [], inflight: [] };
    this.cssWidth = 0;
    this.cssHeight = 0;
    this.colors = {};
    this.animating = false;
    this._phase = 0;
    this._frame = null;
    this._loopBound = () => this._loop();

    this.refreshTheme();
    this._observer = new ResizeObserver(() => this.resize());
    this._observer.observe(canvas);
    this.resize();
  }

  dispose() {
    this._observer.disconnect();
    if (this._frame != null) {
      cancelAnimationFrame(this._frame);
    }
  }

  refreshTheme() {
    const styles = getComputedStyle(this.canvas);
    const read = (name, fallback) => styles.getPropertyValue(name).trim() || fallback;
    this.colors = {
      past: read('--cp-wave-past', '#4daafc'),
      future: read('--cp-wave-future', 'rgba(204,204,204,0.34)'),
      ghost: read('--cp-wave-ghost', 'rgba(204,204,204,0.13)'),
      playhead: read('--cp-wave-playhead', '#cccccc'),
      railEmpty: read('--cp-rail-empty', 'rgba(204,204,204,0.1)'),
      railDecoded: read('--cp-rail-decoded', 'rgba(77,170,252,0.55)'),
      railInflight: read('--cp-rail-inflight', 'rgba(204,167,0,0.6)'),
    };
    this.render();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return;
    }
    const dpr = window.devicePixelRatio || 1;
    this.cssWidth = rect.width;
    this.cssHeight = rect.height;
    this.canvas.width = Math.round(rect.width * dpr);
    this.canvas.height = Math.round(rect.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.render();
  }

  setPeaks(peaks) {
    this.peaks = peaks;
    this.render();
  }

  setDuration(duration) {
    this.duration = Number.isFinite(duration) ? duration : 0;
    this.render();
  }

  setProgress(currentTime) {
    this.currentTime = currentTime;
    this.render();
  }

  setHoverTime(time) {
    this.hoverTime = time;
    this.render();
  }

  setBuffer(buffer) {
    this.buffer = { ...this.buffer, ...buffer };
    // In-flight chunks animate, so keep a frame loop alive only while they exist.
    this.setAnimating(this.buffer.inflight.length > 0);
    this.render();
  }

  setAnimating(on) {
    if (on === this.animating) {
      return;
    }
    this.animating = on;
    if (on) {
      this._frame = requestAnimationFrame(this._loopBound);
    } else if (this._frame != null) {
      cancelAnimationFrame(this._frame);
      this._frame = null;
    }
  }

  timeAtX(x) {
    if (!this.cssWidth || !this.duration) {
      return 0;
    }
    const ratio = Math.min(1, Math.max(0, x / this.cssWidth));
    return ratio * this.duration;
  }

  _loop() {
    this._phase = (this._phase + 0.9) % 24;
    this.render();
    if (this.animating) {
      this._frame = requestAnimationFrame(this._loopBound);
    }
  }

  render() {
    const { ctx } = this;
    const w = this.cssWidth;
    const h = this.cssHeight;
    if (!ctx || w === 0 || h === 0) {
      return;
    }

    ctx.clearRect(0, 0, w, h);

    const railH = 5;
    const railGap = 8;
    const padX = 12;
    const padTop = 14;
    const waveBottom = h - railH - railGap - 10;
    const waveH = waveBottom - padTop;
    const mid = padTop + waveH / 2;
    const innerW = w - padX * 2;

    if (innerW <= 0 || waveH <= 0) {
      return;
    }

    this._drawBars(padX, innerW, mid, waveH / 2);
    this._drawRail(padX, innerW, h - railH - 10, railH);
    this._drawPlayhead(padX, innerW, padTop, waveBottom);
  }

  _drawBars(x0, width, mid, halfH) {
    const { ctx } = this;
    const barW = 2;
    const gap = 1.5;
    const step = barW + gap;
    const cols = Math.max(1, Math.floor(width / step));
    const progress = this.duration > 0 ? this.currentTime / this.duration : 0;
    const playedCols = progress * cols;

    // Peaks arrive chunk by chunk as the engine decodes, so a column is in one of
    // two states: measured, or not seen yet. Unmeasured columns draw as a low
    // ghost stub — visibly a placeholder, and distinct from a measured silence,
    // which draws at the same height in the normal colour.
    for (let i = 0; i < cols; i += 1) {
      const peak = this._peakAt(i / cols, (i + 1) / cols);
      const known = peak >= 0;
      // Gamma lift: quiet passages stay visible instead of collapsing to a line.
      const amp = known ? Math.pow(peak, 0.72) : 0;
      const barH = Math.max(1.5, amp * halfH);
      const x = x0 + i * step;

      if (!known) {
        ctx.fillStyle = this.colors.ghost;
      } else {
        ctx.fillStyle = i < playedCols ? this.colors.past : this.colors.future;
      }

      ctx.beginPath();
      ctx.roundRect(x, mid - barH, barW, barH * 2, 1);
      ctx.fill();
    }
  }

  /** Largest measured peak in the range, or -1 when nothing in it is measured. */
  _peakAt(fromRatio, toRatio) {
    if (!this.peaks || this.peaks.length === 0) {
      return -1;
    }
    const from = Math.floor(fromRatio * this.peaks.length);
    const to = Math.max(from + 1, Math.ceil(toRatio * this.peaks.length));
    let peak = -1;
    for (let i = from; i < to && i < this.peaks.length; i += 1) {
      if (this.peaks[i] > peak) {
        peak = this.peaks[i];
      }
    }
    return peak;
  }

  _drawRail(x0, width, y, height) {
    const { ctx } = this;
    const { chunkCount, decoded, inflight } = this.buffer;

    ctx.fillStyle = this.colors.railEmpty;
    ctx.beginPath();
    ctx.roundRect(x0, y, width, height, height / 2);
    ctx.fill();

    if (!chunkCount) {
      return;
    }

    const rangeRect = (start, end) => {
      const x = x0 + (start / chunkCount) * width;
      // The buffer window is a few chunks out of hundreds, so a range can round
      // to sub-pixel width. Floor it at something you can actually see.
      const w = Math.max(4, ((end + 1 - start) / chunkCount) * width);
      return [x, Math.min(w, x0 + width - x)];
    };

    ctx.fillStyle = this.colors.railDecoded;
    for (const [start, end] of decoded) {
      const [x, w] = rangeRect(start, end);
      ctx.beginPath();
      ctx.roundRect(x, y, w, height, height / 2);
      ctx.fill();
    }

    // In-flight chunks get moving hatching so "fetching now" reads as motion.
    for (const [start, end] of inflight) {
      const [x, w] = rangeRect(start, end);
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(x, y, w, height, height / 2);
      ctx.clip();
      ctx.fillStyle = this.colors.railInflight;
      ctx.globalAlpha = 0.35;
      ctx.fillRect(x, y, w, height);
      ctx.globalAlpha = 1;
      ctx.lineWidth = 3;
      ctx.strokeStyle = this.colors.railInflight;
      for (let sx = x - height * 2 - this._phase; sx < x + w + height * 2; sx += 12) {
        ctx.beginPath();
        ctx.moveTo(sx, y + height + 2);
        ctx.lineTo(sx + height + 4, y - 2);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  _drawPlayhead(x0, width, top, bottom) {
    const { ctx } = this;
    if (!this.duration) {
      return;
    }

    if (this.hoverTime != null) {
      const hx = x0 + (this.hoverTime / this.duration) * width;
      ctx.strokeStyle = this.colors.future;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(hx) + 0.5, top - 6);
      ctx.lineTo(Math.round(hx) + 0.5, bottom + 6);
      ctx.stroke();
    }

    const x = x0 + (this.currentTime / this.duration) * width;
    ctx.fillStyle = this.colors.playhead;
    ctx.beginPath();
    ctx.roundRect(x - 1, top - 8, 2, bottom - top + 16, 1);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, top - 9, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

if (typeof window !== 'undefined') {
  window.WaveformView = WaveformView;
}
