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
