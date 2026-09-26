import { useEffect, useRef, useState } from 'react';
import { Button } from '@raelstream/ui';
import { t } from '@raelstream/i18n';
import { detectOnset, suggestDelay } from '@raelstream/media-runtime';
import { useStore } from '../../lib/useStore.js';
import { studioRuntime } from '../runtime.js';
import s from './steps.module.css';

const CLIP_S = 20;
const FRAME_S = 1 / 30;
/** Filmstrip around the detected clap: 10 frames before it, 10 from it on. */
const STRIP_BEFORE = 10;
const STRIP_AFTER = 10;

interface StripFrame {
  t: number;
  url: string;
}

/** Seek a video and wait until that frame is ready to draw. */
function seekTo(v: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      v.removeEventListener('seeked', done);
      resolve();
    };
    v.addEventListener('seeked', done);
    v.currentTime = t;
  });
}

/**
 * Still pictures of the frames around the clap sound, taken from a hidden copy of the clip, so the
 * operator only has to pick the one where the hands meet.
 */
async function filmstrip(url: string, centreS: number, duration: number): Promise<StripFrame[]> {
  const v = document.createElement('video');
  v.muted = true;
  v.preload = 'auto';
  v.src = url;
  await new Promise<void>((resolve, reject) => {
    v.onloadeddata = () => resolve();
    v.onerror = () => reject(new Error('clip'));
  });
  await settleDuration(v);
  const c = document.createElement('canvas');
  c.width = 192;
  c.height = 108;
  const g = c.getContext('2d')!;
  const out: StripFrame[] = [];
  for (let i = -STRIP_BEFORE; i < STRIP_AFTER; i++) {
    const t = centreS + i * FRAME_S;
    if (t < 0 || t > duration) continue;
    await seekTo(v, t);
    g.drawImage(v, 0, 0, c.width, c.height);
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.8));
    if (blob) out.push({ t, url: URL.createObjectURL(blob) });
  }
  v.removeAttribute('src');
  v.load();
  return out;
}

interface Clip {
  url: string;
  duration: number;
  samples: Float32Array;
  sampleRate: number;
  onsetS: number | null;
  delayMs: number;
}

/** WebM from MediaRecorder has no duration until the browser has seen the end of it. */
async function settleDuration(v: HTMLVideoElement): Promise<number> {
  if (Number.isFinite(v.duration)) return v.duration;
  await new Promise<void>((resolve) => {
    v.ontimeupdate = () => {
      v.ontimeupdate = null;
      resolve();
    };
    v.currentTime = 1e6;
  });
  v.currentTime = 0;
  return v.duration;
}

/**
 * Lip-sync clip tool (SPEC §11.4, SYNC-03): record the outgoing programme while someone claps in front
 * of the camera near a mixer mic, step to the clap frame, compare with the clap sound, adjust, save.
 * The clip stays in this browser and is discarded when the tool closes.
 */
export function SyncTool() {
  const rt = studioRuntime();
  const st = useStore(rt);
  const a = useStore(rt.audio);
  const [phase, setPhase] = useState<'idle' | 'recording' | 'review'>('idle');
  const [left, setLeft] = useState(CLIP_S);
  const [clip, setClip] = useState<Clip | null>(null);
  const [now, setNow] = useState(0);
  const [visualS, setVisualS] = useState<number | null>(null);
  const [saved, setSaved] = useState<'ok' | 'audio_late' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [strip, setStrip] = useState<StripFrame[] | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const wave = useRef<HTMLCanvasElement>(null);
  const recorder = useRef<MediaRecorder | null>(null);

  const status = rt.syncStatus();

  useEffect(
    () => () => {
      if (clip) URL.revokeObjectURL(clip.url);
    },
    [clip],
  );

  async function record() {
    setError(null);
    setSaved(null);
    setVisualS(null);
    const chunks: Blob[] = [];
    const mime = ['video/webm;codecs=vp8,opus', 'video/webm'].find((m) =>
      MediaRecorder.isTypeSupported(m),
    );
    let r: MediaRecorder;
    try {
      r = new MediaRecorder(rt.programmeStream(), mime ? { mimeType: mime } : undefined);
    } catch {
      setError(t('sync.tool.unsupported'));
      return;
    }
    recorder.current = r;
    const delayMs = a.delayMs;
    r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    r.onstop = async () => {
      const blob = new Blob(chunks, { type: r.mimeType || 'video/webm' });
      try {
        const ctx = new OfflineAudioContext(1, 1, 48000);
        const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
        const samples = buf.getChannelData(0).slice();
        const url = URL.createObjectURL(blob);
        setClip({
          url,
          duration: buf.duration,
          samples,
          sampleRate: buf.sampleRate,
          onsetS: detectOnset(samples, buf.sampleRate),
          delayMs,
        });
        setPhase('review');
      } catch {
        setError(t('sync.tool.decodeFailed'));
        setPhase('idle');
      }
    };
    r.start(1000);
    setPhase('recording');
    setLeft(CLIP_S);
    const started = Date.now();
    const timer = setInterval(() => {
      const remaining = CLIP_S - Math.floor((Date.now() - started) / 1000);
      setLeft(remaining);
      if (remaining <= 0 || r.state !== 'recording') {
        clearInterval(timer);
        if (r.state === 'recording') r.stop();
      }
    }, 250);
  }

  // Load the clip into the player and settle its duration so frame stepping works.
  useEffect(() => {
    const v = video.current;
    if (!clip || !v) return;
    v.src = clip.url;
    v.onloadedmetadata = () =>
      void settleDuration(v).then(() => {
        if (clip.onsetS !== null) v.currentTime = Math.max(0, clip.onsetS - FRAME_S * 3);
      });
    v.ontimeupdate = null;
  }, [clip]);

  // The frames around the clap sound, to pick from.
  useEffect(() => {
    setStrip(null);
    if (!clip || clip.onsetS === null) return;
    let frames: StripFrame[] = [];
    let cancelled = false;
    filmstrip(clip.url, clip.onsetS, clip.duration)
      .then((f) => {
        frames = f;
        if (cancelled) f.forEach((x) => URL.revokeObjectURL(x.url));
        else setStrip(f);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      frames.forEach((x) => URL.revokeObjectURL(x.url));
    };
  }, [clip]);

  // Waveform strip with the detected clap (red), the marked frame (blue) and the playhead.
  useEffect(() => {
    const c = wave.current;
    if (!clip || !c) return;
    const g = c.getContext('2d')!;
    const { width: w, height: h } = c;
    g.fillStyle = '#101312';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#9be0b4';
    const per = Math.max(1, Math.floor(clip.samples.length / w));
    for (let x = 0; x < w; x++) {
      let peak = 0;
      for (let i = x * per; i < (x + 1) * per && i < clip.samples.length; i++)
        peak = Math.max(peak, Math.abs(clip.samples[i]!));
      const bar = Math.max(1, peak * h);
      g.fillRect(x, (h - bar) / 2, 1, bar);
    }
    const mark = (tS: number, color: string) => {
      g.fillStyle = color;
      g.fillRect(Math.round((tS / clip.duration) * w), 0, 2, h);
    };
    if (clip.onsetS !== null) mark(clip.onsetS, '#ff5a4f');
    if (visualS !== null) mark(visualS, '#6ea2f0');
    mark(now, '#ffffff');
  }, [clip, now, visualS]);

  /** Play the moment of the clap with its sound: from 1 s before, at normal or quarter speed. */
  function playClap(rate: number) {
    const v = video.current;
    if (!v || !clip || clip.onsetS === null) return;
    v.playbackRate = rate;
    v.currentTime = Math.max(0, clip.onsetS - 1);
    void v.play();
    const stopAt = clip.onsetS + 0.8;
    v.ontimeupdate = () => {
      if (v.currentTime >= stopAt) {
        v.pause();
        v.ontimeupdate = null;
        v.playbackRate = 1;
      }
    };
  }

  function pickFrame(t: number) {
    const v = video.current;
    if (v) {
      v.pause();
      v.currentTime = t;
    }
    setVisualS(t);
  }

  function step(frames: number) {
    const v = video.current;
    if (!v) return;
    v.pause();
    v.currentTime = Math.max(
      0,
      Math.min((clip?.duration ?? 0) - FRAME_S, v.currentTime + frames * FRAME_S),
    );
  }

  const result =
    clip && visualS !== null && clip.onsetS !== null
      ? suggestDelay(clip.delayMs, visualS, clip.onsetS)
      : null;

  async function save() {
    if (!result) return;
    try {
      await rt.saveCalibration(result.measuredOffsetMs, result.result);
      setSaved(result.result);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className={s.syncTool}>
      <div className={s.row}>
        <span
          className={`${s.chip} ${status === 'ok' ? s.chipReady : s.chipStandby}`}
          data-testid="sync-status"
        >
          {status === 'ok'
            ? t('sync.status.ok', {
                ms: st.calibration?.offsetMs ?? 0,
                when: new Date(st.calibration?.measuredAt ?? Date.now()).toLocaleDateString(
                  'en-GB',
                ),
              })
            : status === 'recheck'
              ? t('sync.status.recheck')
              : t('sync.status.none')}
        </span>
      </div>
      {phase === 'idle' && (
        <>
          <p className={s.muted}>{t('sync.tool.how')}</p>
          <div className={s.row}>
            <Button onClick={() => void record()} disabled={a.status !== 'running'}>
              {t('sync.tool.record', { s: CLIP_S })}
            </Button>
          </div>
        </>
      )}
      {phase === 'recording' && (
        <div className={s.row}>
          <p className={s.warn} style={{ flex: 1 }} role="status">
            {t('sync.tool.recording', { s: Math.max(0, left) })}
          </p>
          <Button size="dense" onClick={() => recorder.current?.stop()}>
            {t('sync.tool.stopEarly')}
          </Button>
        </div>
      )}
      {phase === 'review' && clip && (
        <div
          className={s.syncReview}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === ',') step(-1);
            if (e.key === '.') step(1);
          }}
        >
          <video
            ref={video}
            className={s.syncVideo}
            playsInline
            controls={false}
            onTimeUpdate={(e) => setNow(e.currentTarget.currentTime)}
            onSeeked={(e) => setNow(e.currentTarget.currentTime)}
            data-testid="sync-clip"
          />
          <canvas
            ref={wave}
            width={640}
            height={64}
            className={s.syncWave}
            aria-label={t('sync.tool.waveLabel')}
          />
          {clip.onsetS !== null && (
            <>
              <p className={s.muted}>{t('sync.tool.pickHelp')}</p>
              <div className={s.row}>
                <Button size="dense" onClick={() => playClap(1)}>
                  {t('sync.tool.playClap')}
                </Button>
                <Button size="dense" onClick={() => playClap(0.25)}>
                  {t('sync.tool.playClapSlow')}
                </Button>
              </div>
              <div
                className={s.strip}
                role="listbox"
                aria-label={t('sync.tool.stripLabel')}
                data-testid="sync-strip"
              >
                {strip === null ? (
                  <span className={s.muted}>{t('sync.tool.stripLoading')}</span>
                ) : (
                  strip.map((f) => (
                    <button
                      key={f.t}
                      type="button"
                      role="option"
                      aria-selected={visualS === f.t}
                      className={s.stripFrame}
                      onClick={() => pickFrame(f.t)}
                      title={t('sync.tool.frameAt', { s: f.t.toFixed(3) })}
                    >
                      <img src={f.url} alt={t('sync.tool.frameAt', { s: f.t.toFixed(3) })} />
                      <span>
                        {Math.round((f.t - clip.onsetS!) * 1000)} {t('units.ms')}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </>
          )}
          <div className={s.row}>
            <Button size="dense" onClick={() => step(-1)}>
              {t('sync.tool.prevFrame')}
            </Button>
            <Button size="dense" onClick={() => step(1)}>
              {t('sync.tool.nextFrame')}
            </Button>
            <Button size="dense" onClick={() => void video.current?.play()}>
              {t('sync.tool.play')}
            </Button>
            <span className={s.mono}>{now.toFixed(3)} s</span>
            <Button size="dense" variant="primary" onClick={() => setVisualS(now)}>
              {t('sync.tool.markFrame')}
            </Button>
          </div>
          <p className={s.muted}>
            {clip.onsetS !== null
              ? t('sync.tool.onset', { s: clip.onsetS.toFixed(3) })
              : t('sync.tool.noOnset')}
          </p>
          {result && (
            <>
              <p className={result.result === 'ok' ? s.muted : s.warn} data-testid="sync-result">
                {result.result === 'ok'
                  ? t('sync.tool.result', {
                      offset: result.measuredOffsetMs,
                      suggested: result.suggestedMs,
                    })
                  : t('sync.tool.audioLate')}
              </p>
              <div className={s.row}>
                {result.result === 'ok' && result.suggestedMs !== a.delayMs && (
                  <Button size="dense" onClick={() => rt.audio.setDelayMs(result.suggestedMs)}>
                    {t('sync.tool.apply', { ms: result.suggestedMs })}
                  </Button>
                )}
                <Button
                  size="dense"
                  variant="primary"
                  disabled={result.result === 'ok' && result.suggestedMs !== a.delayMs}
                  onClick={() => void save()}
                >
                  {result.result === 'ok' ? t('sync.tool.save') : t('sync.tool.recordFailed')}
                </Button>
              </div>
              {result.result === 'ok' && result.suggestedMs !== a.delayMs && (
                <p className={s.muted}>{t('sync.tool.recheckAfterApply')}</p>
              )}
            </>
          )}
          {saved && (
            <p className={s.muted}>
              {t(saved === 'ok' ? 'sync.tool.saved' : 'sync.tool.savedFailed')}
            </p>
          )}
          <div className={s.row}>
            <Button
              size="dense"
              onClick={() => {
                setClip(null);
                setPhase('idle');
              }}
            >
              {t('sync.tool.close')}
            </Button>
          </div>
        </div>
      )}
      {error && (
        <p className={s.warn} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
