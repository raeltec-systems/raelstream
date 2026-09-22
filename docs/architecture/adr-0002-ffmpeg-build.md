# ADR-0002: One FFmpeg build across the media node (8.1.2 from the pinned MediaMTX image)

- **Status:** Accepted (22 Sep 2026)
- **Context:** SPEC §4.3.1 lists FFmpeg 9.0.x as the newest stable version, with 8.1.x as an allowed fallback.
  The supervisor needs FFmpeg with libx264, AAC, libopus and `drawtext` (for the slate). Options:
  1. Alpine `apk add ffmpeg`: package downloads from inside build containers were unreliable here.
  2. A static build (johnvansickle): its current release is 7.0.2 and has no `drawtext`.
  3. The pinned `bluenviron/mediamtx:1.21.1-ffmpeg` image: FFmpeg 8.1.2, Alpine 3.24.2, with every
     filter and codec we need.
- **Decision:** The supervisor image is `bluenviron/mediamtx:1.21.1-ffmpeg` plus the Node 24 binary from
  `node:24-alpine`. Both are Alpine 3.24.2 with the same musl and libstdc++. It runs as a non-root user.
  The normaliser, publishers, slate renderer and the media test analysis tools all use this same
  FFmpeg 8.1.2 build.
- **Consequences:** Upgrading MediaMTX also upgrades FFmpeg, so the M2 media suite (`pnpm test:media`)
  must pass on every MediaMTX bump. Moving to FFmpeg 9.0 needs a new image source and a media-suite pass.
