# ADR-0003: Normalised programme travels over internal RTMP, not RTSP

- **Status:** Accepted (22 Sep 2026)
- **Context:** The first media-suite run measured A/V offsets of 59–281 ms at the destination, against
  ±80 ms total budget (B§13.4). Controlled experiment, same source (flash + 1 kHz beep every 2 s,
  H.264 + Opus over RTSP), FFmpeg 8.1.2, MediaMTX 1.21.1, audio − video offset in ms:

  | Path | Offsets | Mean |
  |---|---|---|
  | Source as received (baseline; the source beep is quantised to 21 ms audio frames) | 8–24 | ~15 |
  | Normaliser with `aresample=async=1:first_pts=0` → RTSP | only 2 of 7 events paired | broken |
  | Normaliser with `aresample=async=1` → RTSP | 59–102 (jittery) | ~84 |
  | Normaliser with plain `aresample` → RTSP, read over RTSP | 81–146 | 121 |
  | Normaliser with plain `aresample` → RTSP, read over RTMP | 29–45 | 38 |
  | Normaliser with plain `aresample` → file (no hop) | 20–36 | 27 |
  | **Normaliser with plain `aresample` → RTMP**, read over RTSP | −2–15 | 6 |
  | **Normaliser with plain `aresample` → RTMP**, read over RTMP | −7–9 | **2** |

  Republishing AAC over RTSP/RTP loses the audio/video timing relationship. `first_pts=0` makes things
  worse by pinning audio to zero while video keeps its own start time.
- **Decision:** The normaliser uses plain `aresample=44100` (no timestamp warping) and publishes to
  MediaMTX over **RTMP**. Publishers read the programme back over RTMP. The RTMP listener is internal
  only: Compose publishes no RTMP port, and the auth hook allows only the supervisor's internal
  credentials to use `norm/` paths. The contribution is still read over RTSP, which measured fine.
- **Consequences:** The media suite asserts ±35 ms (about one frame) through the normaliser. Real
  WebRTC contributions still need hardware measurement (P-05, M3).
