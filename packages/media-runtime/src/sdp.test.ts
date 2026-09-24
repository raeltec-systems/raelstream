import { describe, expect, it } from 'vitest';
import { opusForProgramme } from './sdp.js';

const ANSWER = [
  'v=0',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111 63',
  'a=rtpmap:111 opus/48000/2',
  'a=fmtp:111 minptime=10;useinbandfec=1',
  'a=rtpmap:63 red/48000/2',
  'a=fmtp:63 111/111',
  'm=video 9 UDP/TLS/RTP/SAVPF 96',
  'a=rtpmap:96 H264/90000',
  'a=fmtp:96 profile-level-id=42e01f',
  '',
].join('\r\n');

describe('opusForProgramme', () => {
  it('allows stereo at programme bitrate on the Opus payload only', () => {
    const out = opusForProgramme(ANSWER);
    expect(out).toContain(
      'a=fmtp:111 minptime=10;useinbandfec=1;stereo=1;sprop-stereo=1;maxaveragebitrate=128000\r\n',
    );
    expect(out).toContain('a=fmtp:63 111/111\r\n');
    expect(out).toContain('a=fmtp:96 profile-level-id=42e01f\r\n');
  });
  it('replaces existing values instead of duplicating them', () => {
    const once = opusForProgramme(ANSWER);
    expect(opusForProgramme(once)).toBe(once);
  });
});
