# FFmpeg on the playback host

Playback needs an `ffmpeg` (and its sibling `ffprobe`) on the machine that runs
the extension host — which on Remote SSH, Dev Containers, WSL, and Codespaces is
the remote machine, not the one with your editor window.

## Resolution order

`checkFfmpegAvailable()` in [`src/ffmpegHost.ts`](../src/ffmpegHost.ts) tries, in order:

1. **`cp-nice-player.ffmpegPath`** — if set, this is the only candidate. An
   explicit setting wins outright: silently running some other ffmpeg would hide
   a typo rather than surface it.
2. **`ffmpeg` on `PATH`**.
3. **The managed install** — a pinned build the extension downloaded into its
   global storage, if one is present.

The resolved path is cached until the setting changes or a download completes.
`ffprobe` is not resolved separately; it is located next to `ffmpeg` (see
`ffprobePathFromFfmpeg` in [`src/playback/stream/probe.ts`](../src/playback/stream/probe.ts)),
which is why the managed install puts both executables in one directory.

## The managed download (Linux only)

When no FFmpeg is found on a Linux host, the extension offers to download one.
macOS and Windows are deliberately not covered: those users are on their own
machine with a package manager and admin rights, while Linux is where the
extension most often runs with neither — a container with no `ffmpeg` and no
root to install one.

Running **CP's Nice Player: Download FFmpeg (Linux)** from the Command Palette
does the same thing on demand.

What the download does:

- Fetches the exact archive pinned in
  [`src/ffmpegDownload/pins.ts`](../src/ffmpegDownload/pins.ts) — a **dated**
  `autobuild-*` tag from [BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds),
  never the `latest` tag, whose assets are rewritten in place.
- Verifies the bytes against a pinned SHA-256 as they stream in, and deletes the
  file if it does not match. Nothing is unpacked before the hash checks out.
- Unpacks only `bin/ffmpeg` and `bin/ffprobe` into
  `<globalStorage>/ffmpeg/<tag>-<arch>/`, marks them `0o755`, and runs
  `ffmpeg -version` once so an incompatible build fails here with a clear
  message instead of later as a vague "ffmpeg was not found".
- Installs via a staging directory and a rename, then prunes older installs.

Honoured along the way: VS Code's `http.proxy` and `http.proxyStrictSSL` (falling
back to the usual `https_proxy` / `http_proxy` environment variables), and the
progress notification's cancel button.

### Requirements and failure modes

- **`tar` with xz support.** Extraction shells out to `tar -xJf`. Slim container
  images sometimes ship a `tar` without xz; the error names the packages to
  install (`xz-utils`, `xz`).
- **glibc.** The pinned builds are glibc-linked. On a musl host (Alpine) the
  install-time `ffmpeg -version` check fails and tells you to install FFmpeg
  yourself and set `cp-nice-player.ffmpegPath`.
- **No network.** Air-gapped and locked-down machines keep working through
  `cp-nice-player.ffmpegPath`, which is never bypassed.

If a download is cancelled or fails, the one-time "FFmpeg was not found" prompt
is re-armed so the offer comes back rather than disappearing forever.

### Licensing

The extension does not redistribute FFmpeg. The pins point at upstream release
URLs and the bytes are fetched by the user's own machine, on request. The pinned
builds are the **LGPL** variants, so nothing here is entangled with this
project's Apache-2.0 licence.

## Bumping the pinned build

[`scripts/pin-ffmpeg.mjs`](../scripts/pin-ffmpeg.mjs) regenerates `pins.ts`. It
downloads each archive, hashes it, cross-checks the digest against the release's
own `checksums.sha256`, and records the paths of the two executables inside the
archive.

```bash
node scripts/pin-ffmpeg.mjs --tag autobuild-2026-08-13-17-03 --branch 8.1
```

With no `--tag` it picks the newest `autobuild-*` release. `--cache <dir>` keeps
the archives between runs, which matters because they are ~100 MB each. Commit
the regenerated `pins.ts`; the pin tests assert the tag is dated, the URLs are
HTTPS, and both executables share a directory inside the archive.
