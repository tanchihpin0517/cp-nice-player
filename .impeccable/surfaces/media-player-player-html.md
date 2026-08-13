---
version: 1
slug: "media-player-player-html"
primary_target: "media/player/player.html"
related_targets: ["media/player/player.css","media/player/playerView.js","media/player/waveform.js","docs/design/player/index.html"]
---

## Scope

The webview player surface: `media/player/` (`player.html`, `player.css`, `playerView.js`, `waveform.js`)
and its browser-runnable mirror in `docs/design/player/`. Visitor mode: **Operate**.

## Audience and job

Audio/music researchers auditioning generated audio (often over Remote SSH), developers with audio in
the workspace, and the author. Four jobs, all confirmed equally real:

1. scan a whole file by scrubbing;
2. re-listen to a short segment repeatedly;
3. inspect audio defects — chunk seams, clicks, underruns;
4. plain start-to-finish playback.

Job 2 was unserved before this redesign and is now carried by locators plus a latching loop.

## Constraints

- Every colour resolves from a `--vscode-*` token. No owned accent. High-contrast light and dark must
  stay usable. (User-confirmed hard constraint — identity has to come from geometry, density,
  engraving and lamp state.)
- Strict webview CSP: no external font, no inline script, no network resource.
- Container-relative layout, not viewport: the tab can be a full editor, a split, or a narrow panel.
- Diagnostics stay, collapsed, with one always-visible health signal.
- Playback tuning lives in VS Code settings, never in this surface.

## Chosen direction

**Transport Bridge** (seed `2c482cb7`, direction/operate, assigned index 3): a Studer/Revox machined
control surface. One plate, 2px milled corners, no pills; rows divided by scored hairlines; engraved
10px micro-caps legends; square keys that light with a lamp bar; a recessed well holding the ruler,
tape and chunk registers.

## Memorable moment

The counter. Monumental tabular digits set into a milled aperture, the largest object on the surface by
a wide margin, reading to the millisecond. It is deliberately **still**: the user asked for the digit-tick
animation to be removed, so the plate reads as a machine through its geometry — scored divisions,
recesses, lamp-lit square keys — and motion is reserved for reporting the stream (fetching chunks blink,
the index scan runs, the busy lamp pulses).

## Unresolved

- The tape envelope can only fill in as the file is heard, because peaks are a by-product of decode.
  Whether to offer an explicit "scan the whole file" pass that decodes ahead purely to draw is open.
- No loop-crossfade: the wrap is a seek, so a latched loop has the seek's boundary behaviour.
