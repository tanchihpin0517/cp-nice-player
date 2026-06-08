# CP's Nice Player

Stream audio files inside VS Code with chunked, low-latency playback powered by FFmpeg and Web Audio.

Instead of transcoding an entire file before play starts, CP's Nice Player scans the source, builds a time-indexed manifest, and fetches **~1 second segments on demand**. Playback begins quickly, seeking jumps to the right chunk, and memory stays bounded to a small sliding buffer.

## Features

- **Chunked streaming** — Audio starts after the first segment is ready, not after a full-file transcode.
- **Responsive seeking** — Scrub to any position; only the chunks you need are fetched and decoded.
- **Bounded memory** — The webview keeps a configurable window of decoded PCM, not the whole track.
- **Broad format support** — MP3, WAV, OGG, Opus, FLAC, M4A, AAC, WebM, MP4, and MKV containers open in the custom editor (audio tracks only).
- **Disk cache** — Transcoded chunks are reused while the playback server is running.
- **Configurable output** — Stream as Ogg Vorbis (default) or FLAC, with tunable chunk size and buffer depth.

## Getting started

### Open a file

Supported files open in **CP's Nice Player** by default. You can also:

- Run **CP's Nice Player: Open in CP's Nice Player** from the Command Palette.
- Right-click a file and choose **Open With… → CP's Nice Player**.

To use a different editor for a file type, use **Reopen Editor With…** or set `workbench.editorAssociations` in Settings.

### Requirements

**FFmpeg** must be installed and available on your `PATH`, or set `cp-nice-player.ffmpegPath` to the executable. FFmpeg is used to probe the source and transcode playback chunks on the host.

If FFmpeg is missing, the extension shows a one-time notification with setup guidance.

## How it works

When you open a track:

1. The extension registers the file with a local playback server on `127.0.0.1`.
2. The server scans audio frames and builds an index of ~1 s, frame-aligned chunks.
3. The player fetches the index, then requests chunks around the playhead.
4. Each chunk is decoded to PCM in the webview and scheduled through Web Audio.
5. On seek, in-flight fetches are cancelled and buffering reprioritizes around the new position.

Cached chunks live under the extension's global storage and are cleared when the playback server stops or restarts.

## Extension settings

| Setting | Default | Description |
| --- | --- | --- |
| `cp-nice-player.ffmpegPath` | *(empty)* | Path to the `ffmpeg` executable. Leave empty to use `ffmpeg` from `PATH`. |
| `cp-nice-player.playback.format` | `ogg` | Output format for streamed chunks: `ogg` (smaller, faster) or `flac` (lossless). |
| `cp-nice-player.playback.oggQuality` | `6` | libvorbis quality (`0`–`10`) when format is `ogg`. Higher is better quality and larger chunks. |
| `cp-nice-player.playback.chunkDurationSec` | `1` | Target duration of each streamed chunk in seconds (`0.5`–`10`). |
| `cp-nice-player.playback.chunkBufferCount` | `5` | Number of chunks to buffer ahead of the playhead, including the current chunk. At 1 s chunks, `5` ≈ 5 s of buffered audio. |

## Known limitations

- **Audio only** — Video tracks are not played; only the audio stream is handled.
- **Local playback** — Streaming is served from localhost inside VS Code, not designed for external players or network deployment.
- **Session cache** — Chunk cache is wiped when the playback server stops or VS Code reloads the extension.

## Release notes

### 0.0.1

Initial release with chunked streaming playback: frame-indexed segments, on-demand FFmpeg transcode, and Web Audio scheduling in the editor webview.
