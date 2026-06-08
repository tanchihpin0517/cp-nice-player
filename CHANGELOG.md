# Changelog

All notable changes to **CP's Nice Player** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.0.1]: https://github.com/tanchihpin0517/cp-nice-player/releases/tag/v0.0.1
