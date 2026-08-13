# Player UI — standalone demo

A browser-runnable copy of the webview UI. No extension host, no FFmpeg, no playback
server: a mock engine simulates chunk fetch/decode on a fake clock so the interface
can be judged, and its failure states exercised, in isolation.

## Run it

```
npm run demo
```

Then open <http://127.0.0.1:8777/docs/design/player/index.html>.

`serve.mjs` is a dependency-free static server (`node docs/design/player/serve.mjs [port]`
if you want a different port). It serves the repository root, because the demo reuses
`media/player/formatUtils.js` from outside its own directory, and binds to `127.0.0.1`
only.

**Working on a remote host?** Keep the bind address as it is and tunnel instead of
exposing the port:

- **VS Code Remote SSH / Dev Containers / Codespaces** — the port is forwarded
  automatically; otherwise add it by hand in the **Ports** panel. Then open the
  URL above in your local browser. This is the same `asExternalUri` forwarding the
  extension itself relies on, so it is worth exercising.
- **Plain SSH** — `ssh -N -L 8777:127.0.0.1:8777 you@host`, then use the same URL
  locally.

A file server is required rather than optional: opening `index.html` from `file://`
gives an opaque origin in some browsers, where `localStorage` throws and the demo
loses its theme and inspector preferences.

## What's in here

| File | Ships? | Purpose |
| --- | --- | --- |
| `index.html` | markup only | Demo shell. The block between the `SHIPPING MARKUP` comments is what goes into `media/player/player.html`, direction contract included. |
| `player.css` | **yes** | The stylesheet, as it will ship. Every colour resolves from a `--vscode-*` token. |
| `waveform.js` | **yes** | The instrument face: ruler, tape and chunk registers on one canvas. |
| `playerView.js` | **yes** | View layer. Talks only to the `StreamingAudioEngine` interface, so it drives the real engine unchanged. |
| `demo/themes.css` | no | Real token values from six themes, standing in for what VS Code injects. |
| `demo/mockEngine.js` | no | Fake engine with the same methods, events and `getDiagnostics()` shape. |
| `demo/demo.js` | no | Plays the extension host: sends `loadMedia`, answers status requests. |
| `demo/demo.css` | no | Demo toolbar chrome. |
| `serve.mjs` | no | Dependency-free static server for running the demo. |

`formatUtils.js` is loaded from `media/player/` directly — the existing helpers are
reused as-is. Keep the three shipping files identical to their `media/player/`
counterparts; the demo is a mirror, not a fork.

## The design

**The player is a machined transport bridge**, not a card. The full direction contract
is the HTML comment at the top of the shipping block, the design system is recorded in
[DESIGN.md](../../../DESIGN.md), and the surface strategy in
`.impeccable/surfaces/media-player-player-html.md`. What matters when editing here:

**Theme-owned palette, geometry-owned identity.** There is no accent this player owns —
the hard constraint is that every colour resolves from a `--vscode-*` token, so the
identity has to be carried by geometry and density instead: 2px milled corners and no
pills anywhere, rows divided by scored hairlines that run edge to edge rather than by
gaps between rounded boxes, engraved 10px micro-caps legends, square keys that light
with a lamp bar, a well recessed into the plate, the counter set behind a scored
aperture, the key bank in a milled channel, and the fader in a slot with scale marks.
Derived tones use `color-mix()` against the theme foreground rather than
`rgba(255,255,255,…)`, which is what makes the same stylesheet work on `#1f1f1f` and on
`#fdf6e3` without a light-theme branch.

High-contrast themes get a branch that swaps every tinted surface for a real
`contrastBorder` line and makes a lit key invert instead of picking up a wash — a 16%
tint is invisible against those grounds.

**One ink, and no tint behind text.** This one was measured, not judged by eye. The
theme's `descriptionForeground` reads 3.4:1 on Dracula and 3.6:1 on Solarized Light
against this plate, so it cannot carry 10px labels; and Solarized Light pairs its *own*
foreground with its own background at only 4.78:1, which leaves no headroom for any
tonal step at all. So: `--cp-plate` is the editor background itself rather than
`editorWidget-background`, `--cp-muted` resolves to `--cp-fg`, `--cp-plate-2` is
reserved for key faces and never sits behind small text, and rows are divided by scored
lines only. Hierarchy comes from size, tracking, weight and the counter's scale — which
is how an engraved panel works anyway. Signal colours get `-text` variants mixed toward
the foreground, because chart yellow on a light plate is under 3:1 and the underrun
count has to stay readable exactly when it is the only thing wrong.

Worst-case measured text contrast, across the demo's six themes: 8.6 / 9.8 / 21.0 /
10.5 / 4.5 / 10.8. The 4.5 is Solarized Light's 66px counter, where the large-text floor
is 3:1; every element at 12px or below clears 4.5:1 in all six. A theme whose own
foreground pairing is under the floor will be under the floor here too — beating it
would mean overriding the theme, which is the one thing this surface may not do.

**The tape is ink; the buffer is the accent.** The two never share a hue. When
heard-so-far and decoded-right-now were both the accent, the tape's coloured extent read
as the *buffered* extent — which is precisely the reading the defect-hunting job depends
on getting right. So the tape's past is full-strength foreground, its future is faint
foreground, and the accent is spent in exactly two places: the playhead, and the chunk
register underneath.

**The face carries the streaming.** The extension's differentiator is chunked streaming,
so the UI shows it. The tape says *what has been heard this session* and accumulates;
the chunk register says *what is in memory right now* and is a handful of chunks wide,
which is why the legend carries an engraved `BUFFER` head — the three swatches key the
chunk register, not the tape.
Two earlier attempts died on the screen and are worth not repeating: shading the tape
bars by the buffer window left ~98% of every file greyed out at all times, and drawing
unread regions at zero height made a freshly opened file look like a player that had
failed to load. Unread tape is now a constant low band — visibly blank tape, never
mistakable for a measurement.

**Every reading carries its limit.** `RING 329 / 341 ms`, `HEAD 53 / 248`,
`UNDERRUN +0`. A ring depth without its capacity, or an underrun count without its
sign, is a number nobody can act on.

**Motion only reports the stream.** Fetching chunks blink in the chunk register, the
status lamp pulses while the player is busy, and a scan bar runs while the index is being
read. Nothing else moves, and all of it stops under `prefers-reduced-motion`. In
particular **the counter does not animate**: an earlier version clicked the seconds
register over per changed digit, which was removed at the user's request — reading a time
is not a state change worth staging, and a register that moves while you are trying to
read a millisecond figure is working against its own job.

**Broken states keep the machine, and are stated once.** A failed index repaints the
status band, which takes the message and the two recovery keys itself; the plate, the
counter and the keys stay exactly where they were, dead rather than deleted, and the well
shrinks to 144px because a full-height empty recess reads as a broken render. There is no
separate fault panel and the well does not restate the failure — an earlier pass said
`NO STREAM` in three places at once. The behaviour before this redesign replaced the
whole player with a card, which cost the user their orientation at the worst moment. A
chunk failing mid-track is recoverable, so it only reaches the event log.

**Two gestures, split by register.** Dragging the ruler marks loop locators; dragging
the tape seeks. `regionAtY()` in `waveform.js` is the one place that decides which,
so it has to stay exact.

**Layout responds to its container, not the viewport** (`container-type: inline-size` on
`.cp-root`), so the narrow layout is correct in a split editor and the demo's width
presets exercise the real breakpoints (720px, 520px). Note that a container query cannot
style `.cp-root` itself, which is why `--cp-well-h` lives on `.cp-player`. At the side
panel width the three legend swatches go but the locator readout stays: it is the only
numeric report of the marked region, and that region is the job this redesign exists to
serve.

## Try the failure modes

The toolbar forces states that are otherwise awkward to reproduce:

- **Index fails** — the index request is refused. The player shows the fault bay and the
  server panel reports `host reachable: failed`.
- **Chunks fail** — the index loads but every chunk 500s, so the chunk register never
  fills and underruns accumulate.
- **FFmpeg missing** — the server panel reports `ffmpeg unavailable`. Independent
  of the two above, so you can see the panel state on its own.
- **Latency** — drag up to 1200 ms to watch the buffer struggle to stay ahead of the
  playhead.

`window.__view` and `window.__engine` are exposed for poking at state from the console —
useful for reaching states the toolbar does not cover, such as seeding peaks or setting
locators.

## Where the waveform data comes from

Nothing is added to the playback server, and the source is never read twice. The
envelope is a by-product of playback: `_decodeAndWriteChunk` already holds the
decoded PCM for each chunk, so it measures 16 buckets from it (`computeChunkPeaks`
in `media/engine/chunkUtils.js`) and ships them on the `decodefinished` event.
`playerView.js` writes each chunk's buckets into one `Float32Array` sized
`chunkCount × bucketsPerChunk`, allocated on the first chunk so the resolution is
whatever the engine actually sends.

The consequence is a tape that fills in as you listen or seek, rather than one that
appears complete up front. Buckets start at `-1`, meaning *not measured yet*, and those
columns draw as the unread band. A decoded silence measures `0` and draws flat in the
normal waveform colour — so the two are told apart by both colour and height.

Peaks are kept for the whole session even after their audio is evicted from the
chunk cache: they are 64 bytes per chunk, so a track heard once stays drawn.

`getDiagnostics()` reports `decodedChunks` / `fetchInFlight` as preformatted
strings (`"0-3, 7"`); `parseChunkRanges()` parses them back, so the engine needed
no change for the chunk register.
