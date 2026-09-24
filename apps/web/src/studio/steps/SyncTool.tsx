import { useEffect, useRef, useState } from 'react';
import { Button } from '@raelstream/ui';
import { t } from '@raelstream/i18n';
import { detectOnset, suggestDelay } from '@raelstream/media-runtime';
import { useStore } from '../../lib/useStore.js';
import { studioRuntime } from '../runtime.js';
import s from './steps.module.css';

const CLIP_S = 20;
const FRAME_S = 1 / 30;

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
    v.onloadedmetadata = () => void settleDuration(v);
    v.ontimeupdate = null;
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
            muted
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
