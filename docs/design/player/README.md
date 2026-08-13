# Player UI redesign — standalone demo

A browser-runnable prototype of the new webview UI. No extension host, no FFmpeg,
no playback server: a mock engine simulates chunk fetch/decode on a fake clock so
the interface can be judged, and its failure states exercised, in isolation.

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
| `index.html` | markup only | Demo shell. The block between the `SHIPPING MARKUP` comments is what goes into `media/player/player.html`. |
| `player.css` | **yes** | The stylesheet, as it will ship. Every colour resolves from a `--vscode-*` token. |
| `waveform.js` | **yes** | Canvas waveform overview + buffer rail. |
| `playerView.js` | **yes** | View layer. Talks only to the `StreamingAudioEngine` interface, so it drives the real engine unchanged. |
| `demo/themes.css` | no | Real token values from six themes, standing in for what VS Code injects. |
| `demo/mockEngine.js` | no | Fake engine with the same methods, events and `getDiagnostics()` shape. |
| `demo/demo.js` | no | Plays the extension host: sends `loadMedia`, answers status requests. |
| `demo/demo.css` | no | Demo toolbar chrome. |
| `serve.mjs` | no | Dependency-free static server for running the demo. |

`formatUtils.js` is loaded from `media/player/` directly — the existing helpers are
reused as-is.

## Design decisions

**Theme-aware, not branded.** There is no fixed accent. `--cp-accent` resolves to
`textLink.foreground`, falling back to `charts.blue`; the play button uses
`button.background`. Derived surfaces use `color-mix()` against the theme
foreground rather than `rgba(255,255,255,…)`, which is what makes the same
stylesheet work on `#1f1f1f` and on `#fdf6e3` without a light-theme branch. The
only hardcoded colours left are the demo toolbar's.

High-contrast themes get a branch that swaps tinted surfaces for real
`contrastBorder` lines, keyed off the `vscode-high-contrast` body class.

**The waveform carries the streaming state.** The extension's differentiator is
chunked streaming, so the UI shows it rather than hiding it:

- bars left of the playhead use the accent, bars right of it are muted
- bars for regions never decoded are flat gray, so the overview visibly fills in
  as playback moves through the file
- a rail under the waveform shows decoded ranges solid and in-flight ranges with
  moving hatching, which is the only animated element when playback is stopped

The bars and the rail answer different questions, which is why both exist. The
bars say *what has been seen* and accumulate for the session; the rail says *what
is in memory right now* and is a handful of chunks wide. An earlier attempt shaded
the bars by the buffer window instead, and rendering it killed the idea: it left
~98% of every waveform greyed out at all times and made the player look broken.

**Broken states don't pretend to work.** When the index cannot be fetched, the
waveform and transport are replaced by an error card carrying the full message, a
retry, and a jump to diagnostics — instead of today's behaviour, a flat waveform
above a row of disabled controls. A chunk failing mid-track is recoverable, so it
only lands in the event log; the card is reserved for "there is nothing to play".

**Diagnostics stay, but move out of the way.** Today's debug panel is open by
default and dominates the page. It is now behind a toggle in the header, split
into server / playback / event log sections, with its open state remembered. The
one-glance signal is promoted to a status pill in the header: a coloured dot plus
text (`Playing`, `Seeking…`, `Index error, retrying: …`).

**Layout responds to its container, not the viewport** (`container-type:
inline-size` on `.cp-root`), so the narrow layout is correct in a split editor,
and the demo's width presets exercise the real breakpoint.

**Keyboard.** Space/`K` play-pause, `J`/`L` skip 10s, `M` mute; with the waveform
focused, arrows seek 5s (30s with Shift) and Home/End jump to the ends.

## Try the failure modes

The toolbar forces states that are otherwise awkward to reproduce:

- **Index fails** — the index request is refused. The player shows the retrying
  error state and the server panel reports `host reachable: failed`.
- **Chunks fail** — the index loads but every chunk 500s, so the rail never
  fills and underruns accumulate.
- **FFmpeg missing** — the server panel reports `ffmpeg unavailable`. Independent
  of the two above, so you can see the panel state on its own.
- **Latency** — drag up to 1200 ms to watch the buffer rail struggle to stay
  ahead of the playhead.

## Where the waveform data comes from

Nothing is added to the playback server, and the source is never read twice. The
envelope is a by-product of playback: `_decodeAndWriteChunk` already holds the
decoded PCM for each chunk, so it measures 16 buckets from it (`computeChunkPeaks`
in `media/engine/chunkUtils.js`) and ships them on the `decodefinished` event.
`playerView.js` writes each chunk's buckets into one `Float32Array` sized
`chunkCount × 16`.

The consequence is a waveform that fills in as you listen or seek, rather than one
that appears complete up front. Buckets start at `-1`, meaning *not measured yet*,
and those columns draw as flat gray stubs. A decoded silence measures `0` and draws
equally flat but in the normal waveform colour — so the two are told apart by
colour, not by height.

Peaks are kept for the whole session even after their audio is evicted from the
chunk cache: they are 64 bytes per chunk, so a track heard once stays drawn.

One note for anyone changing this: `PEAKS_PER_CHUNK` is defined in both
`chunkUtils.js` and `playerView.js` and the two must agree, since the view uses it
to place each chunk's buckets in the global array.

`getDiagnostics()` reports `decodedChunks` / `fetchInFlight` as preformatted
strings (`"0-3, 7"`); `parseChunkRanges()` parses them back, so the engine needed
no change for the buffer rail.
