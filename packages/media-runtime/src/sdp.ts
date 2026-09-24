/** Move preferred codecs to the front of a transceiver's list, where the browser supports it. */
export function preferCodecs(t: RTCRtpTransceiver, kind: 'video' | 'audio', order: string[]): void {
  const caps = RTCRtpReceiver.getCapabilities?.(kind) ?? RTCRtpSender.getCapabilities?.(kind);
  if (!caps || typeof t.setCodecPreferences !== 'function') return;
  const rank = (mime: string) => {
    const i = order.findIndex((o) => mime.toLowerCase() === o.toLowerCase());
    return i === -1 ? order.length : i;
  };
  const sorted = [...caps.codecs].sort((a, b) => rank(a.mimeType) - rank(b.mimeType));
  try {
    t.setCodecPreferences(sorted);
  } catch {
    /* keep browser default */
  }
}

/** Resolve when ICE gathering completes or after `timeoutMs` (non-trickle WHIP offer). */
export function waitForIceGathering(pc: RTCPeerConnection, timeoutMs = 2000): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      pc.removeEventListener('icegatheringstatechange', check);
      clearTimeout(timer);
      resolve();
    };
    const check = () => {
      if (pc.iceGatheringState === 'complete') done();
    };
    const timer = setTimeout(done, timeoutMs);
    pc.addEventListener('icegatheringstatechange', check);
  });
}

/**
 * Let the phone send stereo Opus at programme quality (a stereo iRig, a line feed). Applied to the
 * studio's answer: Chrome only sends stereo when the far end's fmtp says `stereo=1`.
 */
export function opusForProgramme(sdp: string, maxAverageBitrate = 128_000): string {
  const pts = [...sdp.matchAll(/^a=rtpmap:(\d+) opus\/48000\/2\r?$/gim)].map((m) => m[1]);
  let out = sdp;
  for (const pt of pts) {
    out = out.replace(new RegExp(`^(a=fmtp:${pt} )(.*?)(\\r?)$`, 'm'), (_m, head, params, cr) => {
      const keep = String(params)
        .split(';')
        .filter((p) => p && !/^(stereo|sprop-stereo|maxaveragebitrate)=/i.test(p.trim()));
      const add = ['stereo=1', 'sprop-stereo=1', `maxaveragebitrate=${maxAverageBitrate}`];
      return `${head}${[...keep, ...add].join(';')}${cr}`;
    });
  }
  return out;
}
