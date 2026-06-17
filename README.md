# CP's Nice Player

Stream audio files inside VS Code with chunked, low-latency playback powered by FFmpeg and Web Audio.

Instead of transcoding an entire file before play starts, CP's Nice Player scans the source, builds a time-indexed manifest, and fetches **~1 second segments on demand**. Playback begins quickly, seeking jumps to the right chunk, and memory stays bounded to a small sliding buffer.

## Features

- **Chunked streaming** — Audio starts after the first segment is ready, not after a full-file transcode.
- **Responsive seeking** — Scrub to any position; only the chunks you need are fetched and decoded.
- **Bounded memory** — The webview keeps a configurable window of decoded PCM, not the whole track.
- **Broad format support** — MP3, WAV, OGG, Opus, FLAC, M4A, AAC, WebM, MP4, and MKV containers open in the custom editor (audio tracks only).
- **Remote development** — Playback works over Remote SSH, Dev Containers, WSL, and Codespaces via VS Code port forwarding.
- **Disk cache** — Transcoded chunks are reused while the playback server is running.
- **Configurable output** — Stream as Ogg Vorbis (default) or FLAC, with tunable chunk size and buffer depth.

## Installation

Install from your editor's marketplace:

- [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=tanchihpin0517.cp-nice-player)
- [Open VSX](https://open-vsx.org/extension/tanchihpin0517/cp-nice-player) (VSCodium and other Open VSX-based editors)

Or download the `.vsix` from [GitHub Releases](https://github.com/tanchihpin0517/cp-nice-player/releases) and install it with **Extensions: Install from VSIX…**.

## Getting started

### Open a file

Supported files open in **CP's Nice Player** by default. You can also:

- Run **CP's Nice Player: Open in CP's Nice Player** from the Command Palette.
- Right-click a file and choose **Open With… → CP's Nice Player**.

To use a different editor for a file type, use **Reopen Editor With…** or set `workbench.editorAssociations` in Settings.

### Requirements

- **VS Code 1.90.0 or newer** (or a compatible editor such as VSCodium on Open VSX).
- **FFmpeg** must be installed and available on your `PATH`, or set `cp-nice-player.ffmpegPath` in **user** settings to the executable on the machine where playback runs. FFmpeg is used to probe the source and transcode playback chunks on the host.

If FFmpeg is missing, the extension shows a one-time notification with setup guidance.

## How it works

When you open a track:

1. The extension starts a playback server on `127.0.0.1` in the environment where FFmpeg runs.
2. It resolves the server address with `vscode.env.asExternalUri`, which triggers VS Code **port forwarding** when the UI and server are not on the same host (Remote SSH, Dev Containers, WSL, Codespaces, etc.). The webview receives that external URI and fetches chunks through the forwarded port.
3. The server scans audio frames and builds an index of ~1 s, frame-aligned chunks.
4. The player fetches the index, then requests chunks around the playhead.
5. Each chunk is decoded to PCM in the webview and scheduled through Web Audio.
6. On seek, in-flight fetches are cancelled and buffering reprioritizes around the new position.

Cached chunks live under the extension's global storage and are cleared when the playback server stops or restarts.

## Extension settings

| Setting | Default | Description |
| --- | --- | --- |
| `cp-nice-player.ffmpegPath` | *(empty)* | Path to the `ffmpeg` executable on the playback machine. Machine-scoped (user settings only). Leave empty to use `ffmpeg` from `PATH`. |
| `cp-nice-player.playback.format` | `ogg` | Output format for streamed chunks: `ogg` (smaller, faster) or `flac` (lossless). |
| `cp-nice-player.playback.oggQuality` | `6` | libvorbis quality (`0`–`10`) when format is `ogg`. Higher is better quality and larger chunks. |
| `cp-nice-player.playback.chunkDurationSec` | `1` | Target duration of each streamed chunk in seconds (`0.5`–`10`). |
| `cp-nice-player.playback.chunkBufferCount` | `5` | Number of chunks to buffer ahead of the playhead, including the current chunk. At 1 s chunks, `5` ≈ 5 s of buffered audio. |
| `cp-nice-player.playback.fetchConcurrency` | `1` | Maximum parallel chunk downloads (`1`–`10`). `1` fetches sequentially from low to high index. |

## Known limitations

- **Audio only** — Video tracks are not played; only the audio stream is handled.
- **VS Code only** — Streaming is served through VS Code's port forwarding to the extension's localhost server, not for external media players or standalone network deployment.
- **Session cache** — Chunk cache is wiped when the playback server stops or VS Code reloads the extension.

## Release notes

### 0.1.4

Lowers the minimum VS Code version to `1.90.0` and adds automated publishing to Open VSX, the Visual Studio Marketplace, and GitHub Releases.

### 0.1.3

Security hardening: `ffmpegPath` restricted to machine scope, XSS fixes in the debug panel, and strict CORS on the playback server.

### 0.1.2

Fixes playback in remote and containerized setups by resolving the server URL through `vscode.env.asExternalUri`, which triggers VS Code port forwarding. Stream request URLs are built with the `URL` API for safe path joining.

### 0.1.0

Streaming engine overhaul: independent fetch and decode loops, suspend/resume pause without discarding scheduled audio, configurable fetch concurrency, and more reliable seek/buffer behavior.

### 0.0.1

Initial release with chunked streaming playback: frame-indexed segments, on-demand FFmpeg transcode, and Web Audio scheduling in the editor webview.
