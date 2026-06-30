# Changelog

All notable changes to **CP's Nice Player** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.5] - 2026-06-30

### Added

- Setting `cp-nice-player.playback.crossfadeMs` — per-chunk overlap tail length in milliseconds (default `50`, range `0`–`500`) for seamless chunk joins.
- Backend crossfade tails: non-final chunks encode past `endSec` to the nearest source frame; manifest records `crossfadeEndFrame` / `crossfadeEndSec`.
- Frontend WSOLA-aligned linear crossfade at chunk seams (held tail blended with the next chunk head before writing PCM).
- AudioWorklet-based playback via `WorkletScheduler` and a PCM ring buffer (replaces chained `AudioBufferSourceNode` scheduling).
- Setting `cp-nice-player.playback.debugLogging` to opt into verbose playback server and FFmpeg console logs (default `false`).
- Headless unit tests: `npm test` runs Mocha with a `vscode` stub — no Electron or display required (CI/server-friendly).
- Unit tests for chunk planner crossfade, transcode routing, stream cache helpers, route matching, and stream-index manifest validation.

### Changed

- Chunk decoding uses `decodeAudioData` only in the webview.
- Chunk fetching is always sequential (one in-flight download at a time) and server-side FFmpeg transcode is serialized to a single process.
- Playback server startup no longer shows an information toast on every launch.
- Internal restructure: playback engine moved to `src/playback/stream/`, the webview session split into `src/playerPanel/`, and `src/ffmpeg.ts` renamed to `src/ffmpegHost.ts`.
- Media asset folders renamed to singular: `media/player/` and `media/engine/`.

### Removed

- WebCodecs decode path in the streaming engine.
- Setting `cp-nice-player.playback.fetchConcurrency` (replaced by always-sequential fetching).

## [0.1.4] - 2026-06-17

### Changed

- Lower minimum VS Code engine to `^1.90.0` for broader compatibility with VS Code, VSCodium, and other Open VSX-based editors.
- GitHub Actions workflow publishes to **Open VSX**, the **Visual Studio Marketplace**, and **GitHub Releases** when a version tag (`v*`) is pushed.

## [0.1.3] - 2026-06-10

### Security

- **Arbitrary Command Execution:** Restricted `cp-nice-player.ffmpegPath` configuration scope to `machine` to prevent `.vscode/settings.json` hijacking.
- **Cross-Site Scripting (XSS):** Escaped file names and paths in the webview debug panel to prevent DOM-based XSS when opening maliciously named files.
- **Localhost CORS:** Removed wildcard CORS from the playback server and implemented strict origin validation for trusted VS Code webviews to prevent data leaks to malicious external websites.

## [0.1.2] - 2026-06-10

### Fixed

- Playback server URL uses `vscode.env.asExternalUri` so VS Code triggers **port forwarding** when needed; the webview can reach the server in Remote SSH, Dev Containers, WSL, Codespaces, and similar setups.
- Stream request URLs use the `URL` API for safe path joining regardless of trailing slashes on the server base.

## [0.1.1] - 2026-06-09

### Changed

- Lower minimum VS Code engine to `^1.105.1` for broader editor compatibility (including Open VSX / VSCodium).

## [0.1.0] - 2026-06-09

### Added

- Setting `cp-nice-player.playback.fetchConcurrency` — parallel chunk downloads (default `1`, sequential low-to-high).
- Player debug panel: fetch/decode loop state, buffered chunk ranges, active sources, and decoded chunk ranges.

### Changed

- **Streaming engine rewrite** — separate fetch loop (runs for the media session) and decode loop (runs while playing).
- Decode processes all ready chunks in one iteration, then schedules the next iteration after a short idle interval (no overlapping decode polls).
- **Pause / resume** — `AudioContext.suspend()` / `resume()` keeps scheduled sources instead of tearing them down; resume is near-instant when buffered.
- **AudioContext lifecycle** — context opens when media loads and closes when the session ends.
- **Decode progress state** — `decodedChunks` records which chunks have been decoded and scheduled; `activeSources` alone is not enough because finished chunks are removed from it during playback.
- Decode starts only when at least two encoded chunks are ready in the buffer window (or all remaining chunks near track end).
- Index manifest fetch retries until success or the load is cancelled.

### Fixed

- Seek while playing could stall with a moving playhead but no audio when the fetch window raced ahead of the decode target.
- Timing and scheduling edge cases around seek, pause, and chunk boundaries.

## [0.0.1] - 2026-06-08

### Added

- Custom editor for audio files (MP3, WAV, OGG, Opus, FLAC, M4A, AAC, WebM, MP4, MKV).
- **Chunked streaming playback** — frame-indexed ~1 s segments fetched on demand instead of full-file transcode-before-play.
- Local playback server on `127.0.0.1` with `/index` manifest and `/chunk/{n}` segment routes.
- `StreamingAudioEngine` in the webview: index fetch, chunk loader, PCM ring buffer, and Web Audio scheduling.
- On-demand FFmpeg chunk transcode with byte seek and frame-count cuts; disk cache reused during an active server session.
- Command **Open in CP's Nice Player** and default custom editor association for supported file types.
- Settings: `ffmpegPath`, `playback.format` (ogg/flac), `playback.oggQuality`, `playback.chunkDurationSec`, `playback.chunkBufferCount`.
- One-time notification when FFmpeg is missing, with optional custom executable path.

### Notes

- Audio only — video tracks in container files are not played.
- Chunk cache is session-scoped and cleared when the playback server stops or restarts.

[0.1.5]: https://github.com/tanchihpin0517/cp-nice-player/releases/tag/v0.1.5
[0.1.4]: https://github.com/tanchihpin0517/cp-nice-player/releases/tag/v0.1.4
[0.1.3]: https://github.com/tanchihpin0517/cp-nice-player/releases/tag/v0.1.3
[0.1.2]: https://github.com/tanchihpin0517/cp-nice-player/releases/tag/v0.1.2
[0.1.1]: https://github.com/tanchihpin0517/cp-nice-player/releases/tag/v0.1.1
[0.1.0]: https://github.com/tanchihpin0517/cp-nice-player/releases/tag/v0.1.0
[0.0.1]: https://github.com/tanchihpin0517/cp-nice-player/releases/tag/v0.0.1
