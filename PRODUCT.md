# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Three audiences with one shared situation:

- **Audio / music researchers** auditioning model-generated audio, frequently over Remote SSH on a
  GPU host where the file is never copied to the local machine.
- **Developers** who happen to have audio in the workspace — assets, recordings, notification cues —
  and want to hear it without leaving the editor.
- **The author**, whose own workflow is the reference case; public distribution is secondary to it
  being the tool he reaches for.

Shared situation: the file is already visible in the VS Code explorer. The user opens it as an editor
tab, usually in a split beside code, and expects sound almost immediately — including when the
workspace is remote.

## Product Purpose

Play an audio file that lives in a VS Code workspace, in VS Code, without downloading it and without
waiting for a full decode. Success is: the file opens, playback starts within about a second, seeking
is immediate, and what the user hears is trustworthy enough to make a judgement about the audio
itself.

## Positioning

Chunked FFmpeg transcode plus Web Audio streaming (`docs/stream.md`, `docs/frontend.md`): the
extension runs a local playback server that serves frame-aligned encoded chunks, and the webview
reassembles them through an `AudioWorklet` ring buffer. Four consequences a plain `<audio>` element
cannot copy:

- hour-long files and non-browser-native containers (`mkv`, `flac`, `aac`, raw `opus`) start playing
  without a full transcode;
- seeking does not wait for the file, only for the chunk at the target;
- playback works on a remote host through VS Code's forwarded-port tunnel (`asExternalUri`);
- the streaming state is observable — which chunks are decoded, in flight, or underrunning.

## Operating Context

- **Custom editor** (`cpNicePlayer.mediaPreview`) bound to `*.{mp3,wav,ogg,opus,flac,m4a,aac,webm,mp4,mkv}`.
  It opens as an editor tab, so every width from a narrow side-by-side split to a full-width tab is a
  normal case.
- **VS Code webview:** strict CSP — no inline script, no external font or network resource. Theme
  colors arrive as `--vscode-*` CSS variables. Any theme is possible, including high-contrast light
  and dark.
- **Remote development:** Remote SSH, dev containers, Codespaces. The playback server URL is
  forwarded, and "server is alive but the webview cannot reach it" is a real diagnosable state.
- **FFmpeg is an external dependency.** Missing, or present at an unexpected path, is an ordinary
  first-run state rather than an exceptional one.
- **Design harness:** `docs/design/player/` runs the player UI in a plain browser via `npm run demo`
  with a mock engine that can force index failure, chunk failure, missing FFmpeg, and added latency.

## Capabilities and Constraints

**Confirmed jobs** — the user selected all four as real, so none may be designed away:

1. scan a whole file by scrubbing;
2. re-listen to a short segment repeatedly;
3. inspect audio defects — chunk seams, clicks, underruns;
4. plain start-to-finish playback.

Job 2 is currently unserved: there is no loop, no region, and no fine-grained seek in the shipped UI.

**Constraints:**

- Every color must resolve from a `--vscode-*` token. No fixed palette. High-contrast themes must not
  break. (User-confirmed hard constraint.)
- Diagnostics are kept but must be more restrained than today: collapsed by default, one always-visible
  health signal, detail on demand.
- Playback tuning (format, ogg quality, chunk duration, crossfade, buffer count, cache sizes, debug
  logging) lives in VS Code settings, not in the player UI.
- The waveform envelope is a by-product of decode — 16 buckets per chunk, measured in
  `computeChunkPeaks` — so it fills in as the user listens and cannot be complete up front without
  reading the source a second time.
- One file per tab. No playlist, no library, no editing, no export.

## Brand Commitments

- Name: **CP's Nice Player**. Publisher `tanchihpin0517`. Icon at `media/icon.svg` / `media/icon.png`.
- **Must fully follow the active VS Code theme** (user-confirmed). Identity therefore has to come from
  structure, density, typographic rhythm, geometry, and motion — never from an owned accent color.

## Evidence on Hand

- Real audio fixtures in `test_audio_files/` across every supported container, including a long
  musical piece and a deliberately defective file.
- Architecture documented in `docs/stream.md` and `docs/frontend.md`; a prior UI rationale in
  `docs/design/player/README.md`.
- Extensive test suite, including UI tests in `src/test/media/player.test.ts`.
- **No** user research, telemetry, install numbers, testimonials, or performance benchmarks exist.
  Future work must not invent them.

## Product Principles

1. **Sound within a second, or an honest reason why not.** Latency and failure are the two things the
   product is actually judged on.
2. **Show the streaming; do not hide it.** The mechanism is the differentiator, and the user's third
   job is inspecting it.
3. **The theme is the palette.** The player is a guest in someone else's editor.
4. **Broken states are first-class states,** not an afterthought — FFmpeg missing and unreachable
   server are ordinary.
5. **Depth on demand.** A player that only plays must look like a player that only plays; the
   instrumentation is one gesture away.

## Accessibility & Inclusion

- High-contrast light and dark themes must stay usable.
- Every control must be keyboard-reachable; the waveform is an actual `role="slider"`.
- Motion must respect `prefers-reduced-motion`.
