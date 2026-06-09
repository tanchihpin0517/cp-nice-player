# Changelog

All notable changes to **CP's Nice Player** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.1.2]: https://github.com/tanchihpin0517/cp-nice-player/releases/tag/v0.1.2
[0.1.1]: https://github.com/tanchihpin0517/cp-nice-player/releases/tag/v0.1.1
[0.1.0]: https://github.com/tanchihpin0517/cp-nice-player/releases/tag/v0.1.0
[0.0.1]: https://github.com/tanchihpin0517/cp-nice-player/releases/tag/v0.0.1
