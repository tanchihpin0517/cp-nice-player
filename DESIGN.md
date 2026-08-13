---
name: CP's Nice Player
description: A machined transport bridge that borrows the host editor's palette and keeps its identity in geometry, engraving and lamp state.
colors:
  fg: "var(--vscode-foreground, #cccccc)"
  bg: "var(--vscode-editor-background, #1f1f1f)"
  plate: "var(--cp-bg)"
  plate-2: "color-mix(in srgb, var(--cp-fg) 6%, var(--cp-bg))"
  well: "color-mix(in srgb, var(--cp-fg) 8%, var(--cp-bg))"
  channel: "color-mix(in srgb, var(--cp-fg) 3%, var(--cp-bg))"
  muted: "var(--cp-fg)"
  score: "color-mix(in srgb, var(--cp-fg) 15%, transparent)"
  score-2: "color-mix(in srgb, var(--cp-fg) 30%, transparent)"
  bevel: "color-mix(in srgb, var(--cp-fg) 7%, transparent)"
  hover: "var(--vscode-toolbar-hoverBackground, color-mix(in srgb, var(--cp-fg) 10%, transparent))"
  lamp: "var(--cp-fg)"
  lamp-bed: "color-mix(in srgb, var(--cp-fg) 14%, transparent)"
  accent: "var(--vscode-textLink-foreground, var(--vscode-charts-blue, #4daafc))"
  focus: "var(--vscode-focusBorder, #0078d4)"
  ok: "var(--vscode-charts-green, #89d185)"
  warn: "var(--vscode-charts-yellow, #cca700)"
  bad: "var(--vscode-errorForeground, #f85149)"
  ok-text: "color-mix(in srgb, var(--cp-ok) 62%, var(--cp-fg))"
  warn-text: "color-mix(in srgb, var(--cp-warn) 55%, var(--cp-fg))"
  bad-text: "color-mix(in srgb, var(--cp-bad) 72%, var(--cp-fg))"
  wave-past: "var(--cp-fg)"
  wave-future: "color-mix(in srgb, var(--cp-fg) 34%, transparent)"
  wave-ghost: "color-mix(in srgb, var(--cp-fg) 18%, transparent)"
  rail-empty: "color-mix(in srgb, var(--cp-fg) 15%, transparent)"
  tick: "color-mix(in srgb, var(--cp-fg) 24%, transparent)"
  tick-major: "color-mix(in srgb, var(--cp-fg) 46%, transparent)"
  mark-wash: "color-mix(in srgb, var(--cp-fg) 7%, transparent)"
  guide: "color-mix(in srgb, var(--cp-fg) 20%, transparent)"
typography:
  counter:
    fontFamily: "var(--vscode-editor-font-family, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace)"
    fontSize: "66px"
    fontWeight: 500
    lineHeight: 0.92
    letterSpacing: "-0.035em"
    fontFeature: "tabular-nums"
  # The counter has three container steps rather than a fluid clamp: it shrinks
  # before anything else on the bridge is taken away.
  counter-split:
    fontFamily: "var(--vscode-editor-font-family, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace)"
    fontSize: "46px"
    fontWeight: 500
    lineHeight: 0.92
    letterSpacing: "-0.035em"
    fontFeature: "tabular-nums"
    appliesAt: "container <= 720px"
  counter-panel:
    fontFamily: "var(--vscode-editor-font-family, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace)"
    fontSize: "38px"
    fontWeight: 500
    lineHeight: 0.92
    letterSpacing: "-0.035em"
    fontFeature: "tabular-nums"
    appliesAt: "container <= 520px"
  nameplate:
    fontFamily: "var(--vscode-font-family, system-ui, -apple-system, 'Segoe UI', sans-serif)"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.005em"
  body:
    fontFamily: "var(--vscode-font-family, system-ui, -apple-system, 'Segoe UI', sans-serif)"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.6
  value:
    fontFamily: "var(--vscode-editor-font-family, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace)"
    fontSize: "11.5px"
    fontWeight: 600
    letterSpacing: "0"
    fontFeature: "tabular-nums"
  data:
    fontFamily: "var(--vscode-editor-font-family, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace)"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.7
    fontFeature: "tabular-nums"
  engraved:
    fontFamily: "var(--vscode-font-family, system-ui, -apple-system, 'Segoe UI', sans-serif)"
    fontSize: "10px"
    fontWeight: 600
    letterSpacing: "0.13em"
    textTransform: "uppercase"
rounded:
  milled: "2px"
spacing:
  hairline: "2px"
  xxs: "4px"
  xs: "6px"
  sm: "8px"
  md: "10px"
  lg: "12px"
  xl: "14px"
  xxl: "16px"
components:
  plate:
    backgroundColor: "{colors.plate}"
    textColor: "{colors.fg}"
    rounded: "{rounded.milled}"
    width: "min(100%, 1120px)"
  key:
    backgroundColor: "{colors.plate-2}"
    textColor: "{colors.fg}"
    rounded: "{rounded.milled}"
    size: "52px"
    height: "34px"
  key-main:
    size: "62px"
    height: "40px"
  key-hover:
    backgroundColor: "{colors.hover}"
  key-lit:
    backgroundColor: "{colors.lamp-bed}"
    textColor: "{colors.fg}"
  key-label:
    typography: "{typography.engraved}"
    textColor: "{colors.fg}"
  btn:
    backgroundColor: "{colors.plate-2}"
    textColor: "{colors.fg}"
    typography: "{typography.engraved}"
    rounded: "{rounded.milled}"
    height: "24px"
    padding: "0 10px"
  btn-hover:
    backgroundColor: "{colors.hover}"
  diag-key:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    rounded: "{rounded.milled}"
    height: "22px"
    padding: "0 8px"
  diag-key-expanded:
    backgroundColor: "{colors.lamp-bed}"
    textColor: "{colors.fg}"
  aperture:
    backgroundColor: "{colors.well}"
    textColor: "{colors.fg}"
    typography: "{typography.counter}"
    rounded: "{rounded.milled}"
    padding: "6px 14px 8px"
  well:
    backgroundColor: "{colors.well}"
    rounded: "{rounded.milled}"
    height: "clamp(160px, 52vh, 520px)"
  fader:
    backgroundColor: "{colors.well}"
    rounded: "{rounded.milled}"
    height: "26px"
    padding: "0 5px"
  band:
    backgroundColor: "{colors.plate}"
    textColor: "{colors.fg}"
    typography: "{typography.engraved}"
    padding: "8px 12px"
---

# Design System: CP's Nice Player

## Overview

**Creative North Star: "The Transport Bridge"**

The surface is one machined plate, not a stack of cards. Everything sits on a single
ground that is the editor's own background; the plate is separated from the editor by a
scored border rather than by a fill, and its internal rows are separated by 1px scored
hairlines that run edge to edge. Where the category ships a rounded card with a centred
circular play button, this ships a bridge: engraved micro-caps legends, square keys that
light along their bottom edge, a time counter set into a milled aperture at display
scale, and a level fader running in a scored slot.

The palette is not ours and never will be. Every colour resolves from a `--vscode-*`
token, so the plate adopts whatever theme is active — including high-contrast light and
dark, which are a real code branch rather than a hope. Identity is therefore carried by
four things only: **geometry** (2px corners, squares, no pills, no circles), **density**
(10–16px padding, hairline divisions, no decorative whitespace), **engraving** (10px
tracked caps as field labels) and **lamp state** (one lit key at a time). Derived tones
are mixed against the theme's own foreground rather than layered as `rgba(255,255,255,…)`,
because a white overlay vanishes in a light theme.

Contrast headroom is treated as a budget the theme owns, not one we may spend. The plate
adds no tonal step behind small text; the label/value hierarchy is a size-and-form step
instead. Measured worst case across six theme fixtures: 8.6 / 9.8 / 21.0 / 10.5 / 4.5 /
10.8, where the 4.5 is Solarized Light's 66px counter and the large-text floor is 3:1.
Every element at 12px or below clears 4.5:1 in all six.

**Key Characteristics:**
- One plate; rows divided by scored 1px hairlines, never by gaps between boxes.
- 2px milled corners everywhere; no pill, no circle, no capsule.
- Recesses, not raised cards: depth is inset shadow plus a scored border.
- Engraved 10px tracked caps for every field label; monospace for every value.
- One lamp at a time; the lamp is the foreground, not the accent.
- The accent belongs to the stream (playhead, chunk register) and nothing else.
- Layout responds to the container, not the viewport.

## Colors

The theme is the palette: three host tokens (`foreground`, `editor-background`, an accent
link colour) plus signal hues, and every other value on the surface is a `color-mix`
derived from those.

### Primary
- **Stream Accent** (`{colors.accent}`): the host's link colour, or its chart blue. Spent
  only on the stream itself — the canvas playhead, the decoded band of the chunk register,
  the swatch that keys it, and the event-log source name. Nothing else on the plate is
  allowed to take it.

### Secondary
- **Signal Green / Signal Amber / Signal Red** (`{colors.ok}` / `{colors.warn}` /
  `{colors.bad}`): raw theme hues, reserved for non-text marks where the 3:1 floor
  applies — the state lamp, the in-flight rail on the chunk register, the error hue the
  status band is scored in.
- **Signal Text tones** (`{colors.ok-text}` / `{colors.warn-text}` / `{colors.bad-text}`):
  the same hues pulled toward the theme foreground for anything that is read as text
  (underrun count, error status word, diagnostics values). Chart yellow at full strength
  measures under 3:1 on a light plate.

### Neutral
- **Plate** (`{colors.plate}`): the editor background itself. Deliberately *not*
  `editorWidget-background`, which on Solarized Light drops the theme's own
  foreground pairing to 4.4:1 and takes every label on the plate down with it.
- **Control Face** (`{colors.plate-2}`): a 6% foreground tint, reserved for key faces,
  secondary key faces and the diagnostics latch. It never sits behind small text.
- **Recess** (`{colors.well}` 8%) and **Channel** (`{colors.channel}` 3%): the milled
  grounds of the well, the counter aperture, the fader slot and the key channel.
- **Score / Score Strong / Bevel** (`{colors.score}` 15% / `{colors.score-2}` 30% /
  `{colors.bevel}` 7%): the division and edge vocabulary. Score is the default hairline;
  score-strong is a hover border and a secondary key edge; bevel is the single inset
  highlight along the plate's top edge.
- **Ink** (`{colors.fg}`) and **Label Ink** (`{colors.muted}`): the same value. `muted`
  is kept as a *name* meaning "this is a label, not a value", never as a tone.
- **Tape ink** (`{colors.wave-past}` full strength, `{colors.wave-future}` 34%,
  `{colors.wave-ghost}` 18%) and **ruler ticks** (`{colors.tick}` 24%,
  `{colors.tick-major}` 46%): the instrument face's three-level hierarchy, all foreground.

### Named Rules
**The Guest Palette Rule.** Every colour resolves from a `--vscode-*` token. Hex appears
only as a `var()` fallback for the standalone demo and is never a design value. No owned
accent, ever.

**The One Ink Rule.** The plate has exactly one text colour. Solarized Light pairs its own
foreground with its own background at 4.78:1, so there is no headroom for a tonal step:
even a 6% step put 10px labels under 4.5:1. Hierarchy comes from size, tracking, weight
and scale instead.

**The Nothing-Tints-Behind-Text Rule.** No surface behind small text carries a derived
tint. A 10% error tint on the status band measured 4.34:1 on Solarized Light, so the error
state is *scored* in the error hue (1px top and bottom at 60%) rather than filled with it.

**The Accent Belongs to the Stream Rule.** The accent marks decoded-right-now and the
playhead. The tape is ink and the lamp is foreground, precisely so the coloured extent of
the tape can never be misread as the buffered extent.

**The High-Contrast Branch Rule.** Under `body.vscode-high-contrast` /
`.vscode-high-contrast-light`, every derived tint collapses to the plain background, every
score becomes `contrastBorder`, bevel and lamp-bed go transparent, and a lit key inverts
(foreground face, background glyph). A 16% wash is invisible on those grounds.

## Typography

**Display / Value Font:** the host editor font (`--vscode-editor-font-family`, falling
back to `ui-monospace, SFMono-Regular, Menlo, Consolas`)
**Body / Label Font:** the host UI font (`--vscode-font-family`, falling back to
`system-ui, -apple-system, 'Segoe UI'`)

Type comes entirely from the host: the strict webview CSP forbids an external face, and
the brief forbids an owned type voice. The pairing therefore reads as whatever the user's
editor reads as, and the character comes from how the two roles are split — sans for
naming and labelling, mono for every number the machine reports.

**Character:** Instrument legends against instrument readouts. Tracked uppercase labels
are small, dense and quiet; every measurement is tabular monospace so digits do not
shift under change.

### Hierarchy
- **Counter** (500, 66px, 0.92, -0.035em, tabular): the elapsed time, the largest object
  on the plate. Millisecond digits ride at 0.55em, baseline-dropped. Shrinks to 46px at
  720px of container and 38px at 520px.
- **Nameplate** (600, 14px, 1.3, -0.005em): the source name, inline beside its engraved
  legend and ellipsised — a nameplate, never a stacked header.
- **Well legend title** (600, 11px, 0.16em, uppercase): the one word the empty recess says
  about itself.
- **Body** (400, 12px, 1.6, max 46ch): the dead-well hint, the only running prose on the
  surface.
- **Value** (600, 11.5px, tabular, 0 tracking): every reported number and the error
  message — locators, total duration, data-line fields.
- **Data** (400, 11px, 1.7 / 1.75, tabular): diagnostics grids and the event log.
- **Engraved label** (600, 10px, 0.10–0.16em, uppercase): every field label, key label,
  status word, bay head and secondary key.

### Named Rules
**The Size-Step Rule.** The label/value hierarchy is a size and form step, not a tone
step: 10px tracked caps against 11.5px tabular mono. Never reach for a lighter grey to
demote a label.

**The Mono-Is-Measurement Rule.** Monospace is confined to measurement and data —
counter, locators, level value, field values, grids, log, canvas tick labels. Names,
labels and prose stay in the UI font.

**The Tabular Rule.** Anything that changes while playing carries
`font-variant-numeric: tabular-nums`.

## Layout

One centred plate, `max-width: 1120px`, inside a 14px gutter. Vertically it is a stack of
full-width rows — nameplate, status band, instrument face, bridge, data line, optional
diagnostics bays — each separated from the previous by a single 1px scored line
(`.cp-row + .cp-row`). No row is ever inset from the plate's edge; the hairline runs the
full width.

The bridge is a three-column grid (`auto 1fr auto`, 16px gap): counter left, transport
keys centre, level right. Row padding is 8–12px; the face and bridge use 12px, the
nameplate and bay heads 10px 12px, the band and data line 8px 12px. The spacing rhythm
is a tight 2 / 4 / 6 / 8 / 10 / 12 / 14 / 16 set — control gaps are 5–6px, label-to-value
gaps 3–6px, cross-column gaps 10–16px.

**Layout responds to the container, not the viewport.** `.cp-root` declares
`container-type: inline-size`, and the two breakpoints are container queries at 720px and
520px, so the same behaviour holds in a full editor tab, a split, and a narrow side panel.
Because a container query cannot style its own container, the well-height variable
`--cp-well-h` is declared on `.cp-player` rather than `:root`.

- **≤720px (split editor):** the counter shrinks before anything is removed — 46px digits,
  tighter aperture, 46/54px keys, 84px fader, 12px bridge gap, well `clamp(132px, 34vh, 320px)`.
- **≤520px (side panel):** the bridge stacks — counter and level share row one by explicit
  grid placement, keys spread across the full width on row two at `space-between` so every
  key keeps full target size instead of all of them shrinking. The three-swatch buffer key
  is dropped but the locator readout is kept, because it is the only numeric report of the
  marked region. Data-line fields stack into a column and the latch pins to the top edge.

**The Well Earns Its Height Rule.** The tape well takes the pane's spare height
(`clamp(160px, 52vh, 520px)`) only when there is a stream on it; on `empty` and `error` it
collapses to 144px, because a full-height empty recess reads as a broken render.

## Elevation & Depth

Nothing on this surface is raised. There is no drop shadow anywhere: every shadow in the
system is `inset`, and its job is to say *this is milled into the plate*. Depth is a
recess vocabulary — a 1px scored border plus a short inset shadow over a 3–8% foreground
tint — and there is no imitation metal, no gradient sheen, no bevel highlight beyond a
single 1px line along the plate's top edge.

### Shadow Vocabulary
- **Plate bevel** (`inset 0 1px 0 var(--cp-bevel)`): the plate's own top edge, the only
  highlight in the system.
- **Deep recess** (`inset 0 2px 3px color-mix(in srgb, var(--cp-fg) 10%, transparent)`):
  the counter aperture, the deepest cut on the surface.
- **Recess** (`inset 0 1px 2px color-mix(in srgb, var(--cp-fg) 9%, transparent)`): the tape
  well.
- **Shallow recess** (`inset 0 1px 2px` at 8% / 7%): the fader slot and the key channel.

### Named Rules
**The Recess-Only Rule.** Shadows are always inset and always paired with a scored border.
If a surface needs to read as separate, cut it in — never lift it out.

**The Scored Division Rule.** Regions are divided by 1px scored lines running edge to
edge, never by gaps between rounded boxes and never by a filled band.

## Shapes

One radius: **2px milled corners** (`--cp-r`), on the plate, keys, aperture, well, fader
slot, key channel, secondary keys, the diagnostics latch and the hover time flag. The only
other radius in the build is the 1px fader cap. There are no pills, no capsules and no
circles: the state lamp is a 6px **square**, the transport keys are squares (52×34px,
62×40px for play, 34px for mute), the buffer swatches are 14×3px bars, and the fader cap is
a 5×15px rectangle.

The lit-key device is a 2px lamp bar inset 3px from the key's bottom edge, plus a 55%
foreground border and a 14% bed — and an underline on the key's own label, so the latch
survives a monochrome or high-contrast reading.

The instrument face is one canvas holding three stacked registers, divided by scored lines
rather than by margins: a 26px **ruler** with a three-level tick hierarchy and mono tick
labels; the **tape** below it, drawn as 1px bars on a 2px pitch so the field reads as a
measurement rather than a decoration; and a 10px **chunk register** underneath. Locators
are bracket flags in the foreground, told apart by form rather than by hue.

**The Two-Pixel Rule.** Every corner on the surface is 2px. A radius above 2px, or any
fully rounded end, does not belong to this world.

## Components

### Transport Keys
- **Character:** a square that lights.
- **Shape:** 52px column × 34px face (play: 62 × 40; mute: 34px square), 2px corners, 1px
  scored border, 6px gaps, all sitting in a milled channel (3% tint, shallow inset shadow).
- **Face:** control-face tint; icon at 15px (17px on play) in `currentColor`.
- **Hover / Active:** face goes to the host's toolbar hover colour and the border to
  score-strong (120ms ease); active drops to the lamp bed.
- **Lit:** lamp bed face, 55% foreground border, a 2px foreground lamp bar along the bottom
  inner edge, and the key's label underlined at 1px with a 3px offset. In high contrast the
  whole key inverts instead.
- **Disabled:** 0.45 opacity on the key and its label, default cursor.
- **Label:** engraved 10px caps at 0.1em in full ink, sat below the key on the channel.

### Secondary Keys
- **Character:** the same key, flattened to a strip.
- **Style:** 24px high, 0–10px padding, control-face fill with a score-strong border, 2px
  corners, engraved 10px caps. Hover swaps the fill for the host hover colour. Used for
  band recovery actions (Retry now, Server status) and bay actions (Refresh, Restart).
- **Diagnostics latch:** 22px high, transparent fill, label ink, engraved caps with a 13px
  icon. On `aria-expanded="true"` it takes the lit treatment (lamp bed, 55% lamp border,
  full ink) — the only non-key element that lights.

### Status Band
- **Character:** one full-width band saying the single thing that is currently true.
- **Style:** 8px 12px, no fill, its own bottom hairline, a 6px square lamp plus an engraved
  status word; `data-tone` drives the lamp only (`idle` label ink, `busy` amber pulsing at
  1.4s `steps(2)`, `live` green, `error` red plus the error-text status word).
- **Error:** the band takes the message (11.5px mono, `flex 1 1 22ch`) and the two recovery
  keys, and is scored top and bottom in the error hue at 60%. It is the single place state
  lives; nothing else grows a second panel to repeat it.

### Counter
- **Character:** the largest object on the plate, set behind a scored aperture the way a
  tape counter is set into a bridge.
- **Style:** the deep-recess aperture (6px 14px 8px, 2px corners, well fill) holding 66px
  tabular mono; millisecond digits at 0.55em, baseline-aligned to the bottom. Below it, a
  legend row of engraved caps (Elapsed / remaining / Total *value*), each hidden when empty.
- **Motion:** none. The counter is split into two spans at the decimal point so the
  milliseconds can be set smaller, and neither moves. An earlier version clicked each
  changed digit over (`cp-tick`, 110ms `steps(2)`); it was removed at the user's request,
  and the reasoning holds on its own — reading a time is not a state change worth staging,
  and a register that moves while you are reading a millisecond figure works against its
  own job.

### Fader
- **Character:** a slot with scale marks, not a browser track.
- **Style:** a 26px shallow-recess slot (well fill, scored border, 2px corners) with a
  repeating 1px-per-25% tick strip along its bottom inner edge. Inside, a native range
  input (104px, 84px narrow) keeping its keyboard behaviour: a 2px track filled foreground
  to `--cp-range-fill` and rail-empty beyond, with a 5 × 15px rectangular cap at 1px radius.
  Value read out beside it in 10.5px tabular mono at 3ch, right aligned.

### Tape Well (signature)
- **Character:** the instrument face — one canvas, three registers, milled into the plate.
- **Style:** recessed (scored border, well fill, inset shadow, 2px corners), `crosshair`
  cursor, `overflow: hidden`, `touch-action: none`, height per the Well Earns Its Height
  Rule. It is a real `role="slider"` and takes the 2px focus ring.
- **Registers:** 26px ruler (three tick levels, 500 10px mono labels), tape (1px bars at
  2px pitch — past full ink, future 34%, unread a constant 18% band), 10px chunk register
  (accent decoded, amber in-flight, 15% unread). All canvas colours are read out of the
  stylesheet via `getComputedStyle`, so the theme branch and the high-contrast branch reach
  the canvas without a second palette.
- **Hover flag:** a time chip that tracks the pointer — foreground fill, background text,
  11px tabular mono, 2px corners, fading in over 90ms on hover, scrub or mark.
- **Empty / loading / error:** the legend takes over the recess — one engraved word, the
  loading scan bar (120 × 2px, a 34% accent block sweeping at 1.1s linear, present only in
  `loading`), and an optional 12px hint at 46ch. The buffer key row is removed entirely in
  `empty` and `error` rather than reserved blank.

### Data Line
- **Character:** the closed state of the diagnostics, reporting the machine's full identity
  on one line.
- **Style:** 8px 12px, 32px min height, engraved label plus 11.5px mono value per field,
  3px/15px gaps, wrapping. A field with no value removes itself (`:has(> b:empty)`), leaving
  no gap. `data-tone` on a field recolours only its value, to the warn- or bad-text tone.

### Diagnostics Bays
- **Style:** each bay opens with a scored, headed strip (engraved caps, 1px scores top and
  bottom, optional actions right), so no content sits flush against a bare edge. Bodies are
  11px mono — a two-column definition grid (`minmax(96px, 156px) 1fr`, single column under
  520px) or the event log (184px max height, thin themed scrollbar, source name in accent,
  error rows in the bad-text tone).

### Focus & Motion
- **Focus:** a 2px `focusBorder` ring at 2px offset on every button, input and the well.
  The locator model is keyboard-first and the plate is quiet enough to carry it.
- **Motion:** state transitions are 120ms ease on background, border and colour; the hover
  flag is 90ms. Motion is reserved for reporting the stream: fetching chunks blink in the
  chunk register, the busy lamp pulses, and the scan bar runs while the index is read.
  Nothing that carries a *reading* animates — the counter in particular is still. All of it
  is neutralised under `prefers-reduced-motion: reduce`.

## Do's and Don'ts

### Do:
- **Do** resolve every colour from a `--vscode-*` token, and derive any tone with
  `color-mix` against `--cp-fg` so it survives light themes.
- **Do** divide regions with 1px scored hairlines that run edge to edge.
- **Do** cut surfaces in with a scored border plus an inset shadow (the Recess-Only Rule).
- **Do** use 2px corners on everything, and keep squares square.
- **Do** carry label/value hierarchy as a size and form step — 10px tracked caps against
  11.5px tabular mono (the Size-Step Rule).
- **Do** put every measurement in the host's editor font with `tabular-nums`.
- **Do** light exactly one key per action, using the foreground as the lamp, and add a
  non-colour cue (the label underline) alongside it.
- **Do** spend the accent only on the stream — playhead, chunk register, and the swatch
  that keys it.
- **Do** give a signal hue its `-text` variant whenever it is read as text.
- **Do** branch high contrast explicitly: scores become `contrastBorder`, tints collapse,
  lit keys invert.
- **Do** key responsive behaviour to container queries at 720px and 520px, and shrink the
  counter before removing anything.
- **Do** state failure once, in the status band, with its recovery keys.

### Don't:
- **Don't** introduce an owned accent, a fixed hex palette, or an external font — the CSP
  forbids the font and the brief forbids the palette. Hex belongs only in a `var()` fallback.
- **Don't** tint the ground behind small text, and don't use `editorWidget-background` as
  the plate.
- **Don't** demote a label with a lighter tone; there is one ink.
- **Don't** use `descriptionForeground` or any theme "muted" token for a label on this
  plate — measured at 3.4:1 (Dracula) and 3.6:1 (Solarized Light) against this ground.
- **Don't** build depth with a drop shadow, a gradient, or imitation metal. Every shadow is
  inset.
- **Don't** ship a pill, a capsule, a circle, or a radius above 2px — including a circular
  play button.
- **Don't** separate rows with gaps between rounded boxes, or wrap a region in a filled card.
- **Don't** stack an engraved caps label above a heading as a kicker or eyebrow. Engraved
  caps are field labels sat inline beside the value they name.
- **Don't** stand a glyph, emoji, or icon-font character in for an icon: icons are authored
  inline SVG at 1.6 stroke weight with square caps, transport marks as solid geometry.
- **Don't** animate anything that changes every frame — the millisecond register stays
  still — and don't add a motion that survives `prefers-reduced-motion`.
- **Don't** let a second surface repeat a state the status band already owns, or leave a
  recess unlabelled when it is empty.
- **Don't** reserve blank space for a control that has nothing to show; remove it.
