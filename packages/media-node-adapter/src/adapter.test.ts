import { describe, expect, it } from 'vitest';
import {
  PROFILES,
  ProgressParser,
  assertPublicHost,
  backoffMs,
  classifyPublisherError,
  drawtextEscape,
  isPublicAddress,
  isRetryable,
  normaliserArgs,
  publishUrl,
  publisherArgs,
  redact,
  slateArgs,
  validateServerUrl,
  validateStreamKey,
  type Progress,
} from './index.js';

describe('normaliser args (SPEC §12.3)', () => {
  const a = normaliserArgs(
    PROFILES.full_hd,
    'rtsp://u:p@127.0.0.1:8554/live/x/g1/contrib',
    'rtmp://127.0.0.1:1935/norm/x/r?user=u&pass=p',
  );
  const val = (flag: string) => a[a.indexOf(flag) + 1];
  it('encodes H.264 Main, no B-frames, 2 s GOP, 6 Mbps at 1080p', () => {
    expect(val('-c:v')).toBe('libx264');
    expect(val('-profile:v')).toBe('main');
    expect(val('-bf')).toBe('0');
    expect(val('-g')).toBe('60');
    expect(val('-b:v')).toBe('6000k');
    expect(val('-vf')).toContain('scale=1920:1080');
  });
  it('publishes over RTMP and resamples audio without timestamp warping (ADR-0003)', () => {
    expect(a.at(-1)).toMatch(/^rtmp:/);
    expect(val('-af')).toBe('aresample=44100');
    expect(a.join(' ')).not.toContain('async');
  });
  it('converts audio to AAC-LC 128k 44.1 kHz stereo', () => {
    expect(val('-c:a')).toBe('aac');
    expect(val('-ar')).toBe('44100');
    expect(val('-ac')).toBe('2');
  });
  it('is an argument array with no shell metacharacter interpretation', () => {
    expect(Array.isArray(a)).toBe(true);
    expect(a).not.toContain('sh');
  });
});

describe('publisher args', () => {
  it('copies without re-encoding to FLV', () => {
    const a = publisherArgs('rtsp://in', 'rtmps://a.rtmps.youtube.com/live2/KEY');
    expect(a[a.indexOf('-c') + 1]).toBe('copy');
    expect(a[a.indexOf('-f') + 1]).toBe('flv');
  });
});

describe('slate args', () => {
  it('matches the output profile and adds a silent AAC track', () => {
    const a = slateArgs(PROFILES.reliable_hd, {
      outFile: '/s.mp4',
      fontFile: '/f.ttf',
      text: "We'll be right back",
      subtext: 'Grace Chapel: Sunday',
      background: '#161A18',
      accent: '#2F6FCF',
    });
    const joined = a.join(' ');
    expect(joined).toContain('1280x720');
    expect(joined).toContain('anullsrc=channel_layout=stereo:sample_rate=44100');
    expect(a[a.indexOf('-g') + 1]).toBe('60');
  });
  it('escapes drawtext specials', () => {
    expect(drawtextEscape('a:b,c%')).toBe('a\\:b\\,c\\%');
  });
});

describe('ProgressParser', () => {
  it('parses progress blocks split across chunks', () => {
    const got: Progress[] = [];
    const p = new ProgressParser((b) => got.push(b));
    p.push('frame=30\nfps=29.97\nbitrate=6012.3kbits/s\ntotal_size=1234\nout_time_us=1000');
    p.push('000\nspeed=1.01x\nprogress=continue\nframe=60\nout_time_us=N/A\nprogress=end\n');
    expect(got).toHaveLength(2);
    expect(got[0]).toMatchObject({
      frame: 30,
      fps: 29.97,
      totalSize: 1234,
      outTimeUs: 1000000,
      speed: 1.01,
      bitrateKbps: 6012.3,
      end: false,
    });
    expect(got[1]!.outTimeUs).toBeNull();
    expect(got[1]!.end).toBe(true);
  });
});

describe('publisher error classification (B§17.1)', () => {
  it('does not retry auth or media refusals', () => {
    expect(classifyPublisherError('Server error: 403 Forbidden')).toBe('DEST_AUTH_REJECTED');
    expect(classifyPublisherError('NetStream.Publish.BadName')).toBe('DEST_AUTH_REJECTED');
    expect(classifyPublisherError('Could not write header for output file')).toBe(
      'DEST_MEDIA_REJECTED',
    );
    expect(isRetryable('DEST_AUTH_REJECTED')).toBe(false);
  });
  it('treats transport errors as retryable', () => {
    expect(classifyPublisherError('Connection refused')).toBe('DEST_NETWORK');
    expect(classifyPublisherError('something odd')).toBe('DEST_NETWORK');
    expect(isRetryable('DEST_NETWORK')).toBe(true);
  });
});

describe('redact (A40)', () => {
  it('removes stream keys and RTSP credentials', () => {
    const s = redact(
      'Opening rtmps://a.rtmps.youtube.com/live2/abcd-efgh-ijkl failed; rtsp://supervisor:secret@127.0.0.1:8554/x',
      ['abcd-efgh-ijkl'],
    );
    expect(s).not.toContain('abcd-efgh-ijkl');
    expect(s).not.toContain('secret');
  });
  it('removes keys even when not listed', () => {
    expect(redact('rtmps://live-api-s.facebook.com:443/rtmp/FB-1234567890-0-Abc')).not.toContain(
      'FB-1234567890',
    );
  });
});

describe('backoff', () => {
  it('follows 1,2,4,8,15 s with ±20 % jitter', () => {
    expect([0, 1, 2, 3, 4, 9].map((i) => backoffMs(i, () => 0.5))).toEqual([
      1000, 2000, 4000, 8000, 15000, 15000,
    ]);
    expect(backoffMs(0, () => 0)).toBe(800);
    expect(backoffMs(0, () => 1)).toBe(1200);
  });
});

describe('destination validation (A41)', () => {
  it('accepts only allowlisted rtmps endpoints', () => {
    expect(() => validateServerUrl('youtube', 'rtmps://a.rtmps.youtube.com/live2')).not.toThrow();
    expect(() => validateServerUrl('youtube', 'rtmps://a.rtmps.youtube.com/live2/')).not.toThrow();
    expect(() => validateServerUrl('youtube', 'rtmp://a.rtmp.youtube.com/live2')).toThrow(
      'DEST_URL_NOT_ALLOWED',
    );
    expect(() => validateServerUrl('facebook', 'rtmps://a.rtmps.youtube.com/live2')).toThrow(
      'DEST_URL_NOT_ALLOWED',
    );
    expect(() =>
      validateServerUrl('youtube', 'rtmps://user:pw@a.rtmps.youtube.com/live2'),
    ).toThrow();
    expect(() => validateServerUrl('youtube', 'rtmps://169.254.169.254/live2')).toThrow();
  });
  it('allows local sinks only in test mode', () => {
    expect(() => validateServerUrl('youtube', 'rtmp://127.0.0.1:1935/yt')).toThrow();
    expect(() =>
      validateServerUrl('youtube', 'rtmp://127.0.0.1:1935/yt', undefined, true),
    ).not.toThrow();
    expect(() =>
      validateServerUrl('youtube', 'rtmp://rs-test-platform:1935/watch/yt', undefined, true),
    ).not.toThrow();
    expect(() => validateServerUrl('youtube', 'rtmp://rs-test-platform:1935/watch/yt')).toThrow();
    expect(() =>
      validateServerUrl('youtube', 'rtmp://evil.example:1935/yt', undefined, true),
    ).toThrow();
  });
  it('rejects private, loopback, link-local and CGNAT addresses', () => {
    for (const ip of [
      '127.0.0.1',
      '10.1.2.3',
      '172.20.0.1',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '::1',
      'fd00::1',
      'fe80::1',
      '::ffff:10.0.0.1',
    ]) {
      expect(isPublicAddress(ip)).toBe(false);
    }
    expect(isPublicAddress('142.250.1.1')).toBe(true);
  });
  it('refuses hosts that resolve to private addresses at spawn time', async () => {
    const fake = (async () => [{ address: '10.0.0.5', family: 4 }]) as never;
    await expect(
      assertPublicHost(new URL('rtmps://a.rtmps.youtube.com/live2'), false, fake),
    ).rejects.toThrow('DEST_ADDRESS_NOT_PUBLIC');
  });
  it('validates keys and builds the publish URL, keeping query strings', () => {
    expect(() => validateStreamKey('short')).toThrow();
    expect(() => validateStreamKey('abc def ghi')).toThrow();
    expect(publishUrl('rtmps://a.rtmps.youtube.com/live2', 'abcd-1234')).toBe(
      'rtmps://a.rtmps.youtube.com/live2/abcd-1234',
    );
    expect(publishUrl('rtmps://b.rtmps.youtube.com/live2?backup=1', 'abcd-1234')).toBe(
      'rtmps://b.rtmps.youtube.com/live2/abcd-1234?backup=1',
    );
  });
});
