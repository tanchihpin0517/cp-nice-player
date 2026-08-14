/*
 * The instrument face.
 *
 * One canvas, three stacked registers, drawn as a single machined window rather
 * than three separate widgets:
 *
 *   1. RULER  — an engraved time scale with a three-level tick hierarchy, the
 *               locator bracket flags, and the playhead index.
 *   2. TAPE   — mirrored peak bars between two guide rails, coloured past /
 *               future by the playhead, ghosted where nothing has been decoded.
 *   3. CHUNKS — the buffer as a pixel-resolution data field: one column per
 *               screen pixel, decoded / fetched / unread.
 *
 * The ruler and the tape answer different questions, which is why both exist:
 * the tape says what has been heard this session and accumulates, the chunk
 * field says what is in memory right now and is a handful of chunks wide.
 *
 * Colours are pulled from the stylesheet's custom properties so the canvas
 * follows the active VS Code theme. Call refreshTheme() after a theme change.
 */

/** Time steps the ruler is allowed to use, so ticks land on readable values. */
const TICK_STEPS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600];
const RULER_H = 26;
const CHUNK_H = 10;
/** 1px bar + 1px gap: the field is a measurement, not a decoration. */
const BAR_PITCH = 2;
/**
 * Half-height of a column nothing has been decoded for. Blank tape is still
 * visibly tape: drawing unread regions at zero made a freshly opened file look
 * like a player that had failed to load rather than one that had not been heard.
 */
const UNREAD_HALF = 3;

class WaveformView {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.peaks = null;
    this.duration = 0;
    this.currentTime = 0;
    this.hoverTime = null;
    this.locators = { in: null, out: null };
    this.loopActive = false;
    this.buffer = { chunkCount: 0, chunkDurationSec: 1, decoded: [], fetched: [] };
    this.cssWidth = 0;
    this.cssHeight = 0;
    this.colors = {};

    this.refreshTheme();
    this._observer = new ResizeObserver(() => this.resize());
    this._observer.observe(canvas);
    this.resize();
  }

  dispose() {
    this._observer.disconnect();
  }

  refreshTheme() {
    const styles = getComputedStyle(this.canvas);
    const read = (name, fallback) => styles.getPropertyValue(name).trim() || fallback;
    this.colors = {
      past: read('--cp-wave-past', '#4daafc'),
      future: read('--cp-wave-future', 'rgba(204,204,204,0.42)'),
      ghost: read('--cp-wave-ghost', 'rgba(204,204,204,0.12)'),
      playhead: read('--cp-wave-playhead', '#cccccc'),
      railEmpty: read('--cp-rail-empty', 'rgba(204,204,204,0.09)'),
      railDecoded: read('--cp-rail-decoded', 'rgba(77,170,252,0.62)'),
      railFetched: read('--cp-rail-fetched', '#cca700'),
      tick: read('--cp-tick', 'rgba(204,204,204,0.24)'),
      tickMajor: read('--cp-tick-major', 'rgba(204,204,204,0.46)'),
      label: read('--cp-wave-label', 'rgba(204,204,204,0.7)'),
      score: read('--cp-score', 'rgba(204,204,204,0.15)'),
      guide: read('--cp-guide', 'rgba(204,204,204,0.2)'),
      mark: read('--cp-mark', '#cccccc'),
      markWash: read('--cp-mark-wash', 'rgba(204,204,204,0.07)'),
      mono: read('--cp-mono', 'ui-monospace, Menlo, monospace'),
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

  setLocators(locators) {
    this.locators = { ...this.locators, ...locators };
    this.render();
  }

  setLoopActive(active) {
    this.loopActive = Boolean(active);
    this.render();
  }

  setBuffer(buffer) {
    this.buffer = { ...this.buffer, ...buffer };
    this.render();
  }

  /** The time axis spans the full canvas, so a click lands where it looks. */
  timeAtX(x) {
    if (!this.cssWidth || !this.duration) {
      return 0;
    }
    const ratio = Math.min(1, Math.max(0, x / this.cssWidth));
    return ratio * this.duration;
  }

  xAtTime(seconds) {
    if (!this.duration) {
      return 0;
    }
    const ratio = Math.min(1, Math.max(0, seconds / this.duration));
    return ratio * this.cssWidth;
  }

  /**
   * Which register a pointer is over. Dragging the ruler marks locators;
   * dragging the tape seeks. Two gestures on one surface need this to be exact.
   */
  regionAtY(y) {
    if (y <= RULER_H) {
      return 'ruler';
    }
    if (y >= this.cssHeight - CHUNK_H) {
      return 'chunks';
    }
    return 'tape';
  }

  render() {
    const { ctx } = this;
    const w = this.cssWidth;
    const h = this.cssHeight;
    if (!ctx || w === 0 || h === 0) {
      return;
    }

    ctx.clearRect(0, 0, w, h);

    const tapeTop = RULER_H + 1;
    const tapeBottom = h - CHUNK_H - 1;
    if (tapeBottom - tapeTop < 12) {
      return;
    }

    this._drawLoopRegion(tapeTop, tapeBottom);
    this._drawRuler(w, tapeTop);
    this._drawTape(tapeTop, tapeBottom);
    this._drawChunkField(w, h - CHUNK_H, CHUNK_H);
    this._drawLocators(tapeTop, tapeBottom);
    this._drawPlayhead(tapeTop, tapeBottom);
  }

  // ---------------------------------------------------------------- ruler

  /** Smallest allowed step whose spacing is at least minPx wide. */
  _pickStep(minPx) {
    const pxPerSec = this.duration > 0 ? this.cssWidth / this.duration : 0;
    if (!pxPerSec) {
      return 0;
    }
    for (const step of TICK_STEPS) {
      if (step * pxPerSec >= minPx) {
        return step;
      }
    }
    return TICK_STEPS[TICK_STEPS.length - 1];
  }

  _drawRuler(w, tapeTop) {
    const { ctx } = this;

    // The scored line under the ruler is drawn whether or not there is tape, so
    // an empty machine still reads as a machine.
    ctx.fillStyle = this.colors.score;
    ctx.fillRect(0, tapeTop - 1, w, 1);

    if (!this.duration) {
      return;
    }

    const major = this._pickStep(78);
    const mid = this._pickStep(26);
    const minor = this._pickStep(7);
    const base = tapeTop - 1;

    const drawTicks = (step, height, color) => {
      if (!step) {
        return;
      }
      ctx.fillStyle = color;
      for (let t = 0; t <= this.duration + 1e-6; t += step) {
        const x = Math.round(this.xAtTime(t));
        if (x > w) {
          break;
        }
        ctx.fillRect(Math.min(x, w - 1), base - height, 1, height);
      }
    };

    if (minor && minor < mid) {
      drawTicks(minor, 4, this.colors.tick);
    }
    if (mid && mid < major) {
      drawTicks(mid, 7, this.colors.tick);
    }
    drawTicks(major, 12, this.colors.tickMajor);

    // Numerals sit above their tick, clamped inside the window so the first and
    // last are never half-cropped.
    ctx.fillStyle = this.colors.label;
    ctx.font = '500 10px ' + this.colors.mono;
    ctx.textBaseline = 'top';
    for (let t = major; t < this.duration - major * 0.5; t += major) {
      const label = this._tickLabel(t, major);
      const width = ctx.measureText(label).width;
      const x = Math.min(w - width - 3, Math.max(3, this.xAtTime(t) + 4));
      ctx.fillText(label, x, 3);
    }
  }

  _tickLabel(seconds, step) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (step < 1) {
      return mins + ':' + secs.toFixed(1).padStart(4, '0');
    }
    return mins + ':' + String(Math.round(secs)).padStart(2, '0');
  }

  // ----------------------------------------------------------------- tape

  _drawTape(top, bottom) {
    const { ctx } = this;
    const w = this.cssWidth;
    const mid = (top + bottom) / 2;
    const halfH = (bottom - top) / 2 - 3;

    // Guide rails: the tape runs between them.
    ctx.fillStyle = this.colors.guide;
    ctx.fillRect(0, top, w, 1);
    ctx.fillRect(0, bottom - 1, w, 1);

    // Centre line, so a silent passage still has an axis to read against.
    ctx.fillStyle = this.colors.score;
    ctx.fillRect(0, Math.round(mid), w, 1);

    if (halfH <= 2) {
      return;
    }

    const cols = Math.max(1, Math.floor(w / BAR_PITCH));
    const progress = this.duration > 0 ? this.currentTime / this.duration : 0;
    const playedCols = progress * cols;

    // Peaks arrive chunk by chunk as the engine decodes, so a column is in one
    // of two states: measured, or not seen yet. Unmeasured columns draw as a low
    // ghost stub — visibly a placeholder, and distinct from a measured silence,
    // which draws at the same height in the normal colour.
    for (let i = 0; i < cols; i += 1) {
      const peak = this._peakAt(i / cols, (i + 1) / cols);
      const known = peak >= 0;
      // Gamma lift: quiet passages stay visible instead of collapsing to a line.
      const amp = known ? Math.pow(peak, 0.72) : 0;
      const barH = known
        ? Math.max(1, amp * halfH)
        : Math.min(UNREAD_HALF, halfH);
      const x = i * BAR_PITCH;

      if (!known) {
        ctx.fillStyle = this.colors.ghost;
      } else {
        ctx.fillStyle = i < playedCols ? this.colors.past : this.colors.future;
      }

      ctx.fillRect(x, Math.round(mid - barH), 1, Math.max(1, Math.round(barH * 2)));
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

  // --------------------------------------------------------- chunk field

  /**
   * Rasterised per screen pixel rather than per chunk: a thousand chunks in a
   * thousand pixels means sub-pixel cells, and rounding each one up turns the
   * whole field into a lie about how much is buffered.
   */
  _drawChunkField(w, y, height) {
    const { ctx } = this;
    const { chunkCount, decoded, fetched } = this.buffer;

    ctx.fillStyle = this.colors.score;
    ctx.fillRect(0, y - 1, w, 1);

    ctx.fillStyle = this.colors.railEmpty;
    ctx.fillRect(0, y, w, height);

    if (!chunkCount) {
      return;
    }

    const cols = Math.max(1, Math.ceil(w));
    const state = new Uint8Array(cols);
    const paint = (ranges, value) => {
      for (const [start, end] of ranges) {
        const from = Math.max(0, Math.floor((start / chunkCount) * cols));
        const to = Math.min(cols, Math.max(from + 1, Math.ceil(((end + 1) / chunkCount) * cols)));
        for (let i = from; i < to; i += 1) {
          state[i] = value;
        }
      }
    };
    // The field reads as a pipeline running left to right through each chunk:
    // unread, then fetched, then decoded. Decoded wins the shared pixel because
    // it is the further-along state — a chunk still counts as fetched once its
    // bytes are decoded, and painting that over the top would undo the reading.
    paint(fetched, 1);
    paint(decoded, 2);

    let runStart = 0;
    for (let i = 1; i <= cols; i += 1) {
      if (i === cols || state[i] !== state[runStart]) {
        const value = state[runStart];
        if (value) {
          ctx.fillStyle = value === 2 ? this.colors.railDecoded : this.colors.railFetched;
          ctx.fillRect(runStart, y, i - runStart, height);
        }
        runStart = i;
      }
    }
  }

  // -------------------------------------------------------------- markers

  _hasRegion() {
    const { in: from, out: to } = this.locators;
    return from != null && to != null && to > from;
  }

  _drawLoopRegion(top, bottom) {
    if (!this._hasRegion() || !this.duration) {
      return;
    }
    const { ctx } = this;
    const x0 = this.xAtTime(this.locators.in);
    const x1 = this.xAtTime(this.locators.out);
    ctx.fillStyle = this.colors.markWash;
    ctx.fillRect(x0, top, Math.max(1, x1 - x0), bottom - top);
  }

  /**
   * A locator is a hairline down the tape with a foot in the ruler, and the
   * region between two of them carries a bar across the ruler — solid while the
   * loop is latched, a hairline while it is only marked. Markers are told apart
   * from the playhead by form rather than by hue, because the palette belongs to
   * the theme and cannot be spent on a second marker colour.
   */
  _drawLocators(top, bottom) {
    if (!this.duration) {
      return;
    }
    const { ctx } = this;
    const barY = RULER_H - 13;

    if (this._hasRegion()) {
      const x0 = Math.round(this.xAtTime(this.locators.in));
      const x1 = Math.round(this.xAtTime(this.locators.out));
      ctx.fillStyle = this.colors.mark;
      ctx.fillRect(x0, barY, Math.max(2, x1 - x0), this.loopActive ? 3 : 1);
    }

    const drawEdge = (seconds) => {
      if (seconds == null) {
        return;
      }
      const x = Math.round(Math.min(this.cssWidth - 1, Math.max(0, this.xAtTime(seconds))));
      ctx.fillStyle = this.colors.mark;
      ctx.fillRect(x, top, 1, bottom - top);
      ctx.fillRect(x, barY, 1, 13);
    };

    drawEdge(this.locators.in);
    drawEdge(this.locators.out);
  }

  _drawPlayhead(top, bottom) {
    const { ctx } = this;
    if (!this.duration) {
      return;
    }

    if (this.hoverTime != null) {
      const hx = Math.round(this.xAtTime(this.hoverTime));
      ctx.fillStyle = this.colors.future;
      for (let y = top; y < bottom; y += 4) {
        ctx.fillRect(Math.min(hx, this.cssWidth - 1), y, 1, 2);
      }
    }

    const x = Math.min(this.cssWidth - 2, Math.max(0, this.xAtTime(this.currentTime)));
    ctx.fillStyle = this.colors.playhead;
    ctx.fillRect(Math.round(x), top, 2, bottom - top);

    // The head index: a solid flag hanging in the ruler above the tape.
    ctx.beginPath();
    ctx.moveTo(Math.round(x) - 4, RULER_H - 11);
    ctx.lineTo(Math.round(x) + 6, RULER_H - 11);
    ctx.lineTo(Math.round(x) + 1, RULER_H - 1);
    ctx.closePath();
    ctx.fill();
  }
}

if (typeof window !== 'undefined') {
  window.WaveformView = WaveformView;
}
