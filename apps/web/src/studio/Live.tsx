import { useEffect, useRef, useState } from 'react';
import { Button, KeyChip, Logo, Meter, StatusDot, cx } from '@raelstream/ui';
import { t } from '@raelstream/i18n';
import {
  CAMERA_STEPS,
  UPLOAD_STEPS,
  meterPosition,
  type SceneKind,
} from '@raelstream/media-runtime';
import { useStore } from '../lib/useStore.js';
import { router } from '../lib/router.js';
import { PROFILE_SIZE, studioRuntime } from './runtime.js';
import { BroadcastAction, BroadcastBanners, DestinationRows, SessionPill } from './Broadcast.js';
import { CameraPreview, ReconnectPanel } from './steps/DevicesStep.js';
import { typeLabel } from './steps/RundownStep.js';
import { LeaseBanner } from './LeaseBanner.js';
import { UpdateBanner } from './UpdateBanner.js';
import s from './Live.module.css';

const SCENES: { kind: SceneKind; key: string; label: string }[] = [
  { kind: 'camera_lower_third', key: '1', label: 'scene.cameraLowerThird' },
  { kind: 'camera', key: '2', label: 'scene.cameraOnly' },
  { kind: 'text', key: '3', label: 'scene.textCard' },
  { kind: 'slate', key: '4', label: 'scene.slate' },
];

/** Shortcuts never fire while typing, inside a modal, or on key auto-repeat (SPEC §9.7). */
export function shortcutAllowed(e: KeyboardEvent): boolean {
  if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return false;
  const el = document.activeElement as HTMLElement | null;
  if (el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)))
    return false;
  if (document.querySelector('[role="dialog"]')) return false;
  return true;
}

export function Live() {
  const rt = studioRuntime();
  const st = useStore(rt);
  const cam = useStore(rt.camera);
  const comp = useStore(rt.compositor);
  const audio = useStore(rt.audio);
  const whip = useStore(rt.whip ?? NULL_STORE);
  const programmeRef = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // The preview IS the programme canvas, scaled by CSS (SPEC §9.2).
  useEffect(() => {
    const c = rt.compositor.canvas;
    c.className = s.canvas!;
    c.setAttribute('aria-label', t('live.programmeAria'));
    c.setAttribute('role', 'img');
    programmeRef.current?.appendChild(c);
    return () => c.remove();
  }, [rt.compositor]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!shortcutAllowed(e)) return;
      const scene = SCENES.find((x) => x.key === e.key);
      if (scene) {
        e.preventDefault();
        void rt.cut(scene.kind);
      } else if (
        e.key === ' ' &&
        (document.activeElement === document.body || document.activeElement === null)
      ) {
        // Space only when no control has focus, so it never double-fires a focused button.
        e.preventDefault();
        void rt.takeNext();
      } else if (e.key === 'M' && e.shiftKey) {
        rt.audio.setMuted(!rt.audio.snapshot.muted);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rt]);

  const onProgrammeCamera = st.scene === 'camera' || st.scene === 'camera_lower_third';
  const tallyTone = cam.connection !== 'connected' ? 'off' : onProgrammeCamera ? 'live' : 'ready';
  const nextIdx = rt.nextIndex();
  const next = nextIdx !== null ? st.rundown[nextIdx] : undefined;
  const sending = st.contribution === 'sending';
  const src = st.session?.sources.find((x) => x.status === 'admitted');

  const upBps = whip?.bitrateBps ?? null;
  const laptop =
    whip?.qualityLimitation === 'cpu'
      ? t('health.laptopWorkingHard')
      : whip
        ? t('health.laptopKeepingUp')
        : '—';

  return (
    <div className={s.frame} data-theme="dark">
      <header className={s.top}>
        <Logo ring={20} />
        <div className={s.divider} />
        <div className={s.service}>
          <div className={s.serviceName}>{st.session?.name}</div>
          <div className={s.serviceSub}>{PROFILE_SIZE[st.profile].label}</div>
        </div>
        <div className={s.spacer} />
        <SessionPill
          now={now}
          cameraDropped={!!comp.autoCutAt}
          cameraReconnecting={!!src && cam.connection !== 'connected'}
        />
        <div className={s.uplink}>
          <StatusDot
            tone={sending ? (whip?.status === 'connected' ? 'ready' : 'standby') : 'off'}
          />
          {sending ? t('live.uplinkSending') : t('live.uplinkIdle')}
        </div>
        <Button size="dense" onClick={() => router.go('/studio')}>
          {t('live.preparation')}
        </Button>
        {!rt.isLive &&
          (st.contribution === 'sending' || st.contribution === 'starting' ? (
            <Button size="dense" onClick={() => void rt.stopPrivateTest()}>
              {t('live.stopPrivateTest')}
            </Button>
          ) : (
            <Button
              size="dense"
              disabled={!st.lease?.mine}
              onClick={() => void rt.startPrivateTest()}
            >
              {t('live.startPrivateTest')}
            </Button>
          ))}
        <BroadcastAction now={now} />
      </header>

      <div className={s.banners}>
        <LeaseBanner compact />
        <UpdateBanner />
        <BroadcastBanners />
      </div>
      <main className={s.main}>
        <section className={s.col} aria-label={t('live.sources')}>
          <div className="rs-overline">{t('live.sources')}</div>
          <div className={s.sourceCard}>
            <div className={cx(s.thumb, s[`tally_${tallyTone}`])}>
              <CameraPreview className={s.thumbVideo} />
            </div>
            <div className={s.sourceRow}>
              <StatusDot tone={cam.connection === 'connected' ? 'ready' : 'standby'} size={8} />
              <span className={s.sourceName}>{src?.label ?? t('live.noCamera')}</span>
              <span className="rs-mono">
                {cam.summary?.rttMs != null ? `${Math.round(cam.summary.rttMs)} ms` : '—'}
              </span>
            </div>
            {src?.status === 'admitted' && !st.cameraPresent[src.id] && <ReconnectPanel />}
          </div>
          <div className="rs-overline">{t('live.scenes')}</div>
          {comp.autoCutAt &&
            st.scene === 'slate' &&
            cam.connection === 'connected' &&
            !comp.cameraStalled &&
            comp.lastCameraFrameAt !== null && (
              // SPEC §8.6: the camera never returns to programme by itself; offer the cut instead.
              <button
                type="button"
                className={cx(s.scene, s.cutBack)}
                onClick={() => void rt.cut('camera')}
              >
                {t('live.cutBack')}
              </button>
            )}
          {SCENES.map((sc) => {
            // These scenes show a rundown item; without one the button would do nothing.
            const needs =
              sc.kind === 'camera_lower_third' ? 'lower_third' : sc.kind === 'text' ? 'text' : null;
            const missing = !!needs && !st.rundown.some((x) => x.type === needs);
            return (
              <button
                key={sc.kind}
                type="button"
                className={cx(s.scene, st.scene === sc.kind && s.sceneActive)}
                aria-pressed={st.scene === sc.kind}
                disabled={missing}
                title={missing ? t(`live.needs.${needs!}`) : undefined}
                onClick={() => void rt.cut(sc.kind)}
              >
                <KeyChip>{sc.key}</KeyChip>
                <span>{t(sc.label as never)}</span>
              </button>
            );
          })}
          {(['lower_third', 'text'] as const)
            .filter((k) => !st.rundown.some((x) => x.type === k))
            .map((k) => (
              <p key={k} className={s.sceneHint}>
                {t(`live.needs.${k}`)}
              </p>
            ))}
        </section>

        <section className={s.center} aria-label={t('live.programme')}>
          <div className={s.overlineRow}>
            <span className="rs-overline">{t('live.programme')}</span>
            <span className="rs-overline">{t('live.beforePlatformDelay')}</span>
          </div>
          <div
            ref={programmeRef}
            className={cx(
              s.programme,
              s[`tally_${onProgrammeCamera && cam.connection === 'connected' ? 'live' : 'off'}`],
            )}
          />
          <div className={s.quality}>
            {cam.summary?.height
              ? t('live.quality', {
                  src: `${cam.summary.height}p`,
                  out: `${PROFILE_SIZE[st.profile].h}p`,
                }) + (cam.summary.height < PROFILE_SIZE[st.profile].h ? t('live.upscaled') : '')
              : t('live.noCameraFrames')}
          </div>
          <div className={s.nextRow}>
            <div className={s.next}>
              {next ? (
                <>
                  {t('live.next')} <b>{next.title}</b> · {typeLabel(next.type).toLowerCase()}
                </>
              ) : (
                t('live.endOfRundown')
              )}
            </div>
            <Button size="dense" onClick={() => void rt.cut('camera')}>
              {t('live.clearGraphics')}
            </Button>
            <Button
              size="dense"
              variant="primary"
              keyHint="Space"
              disabled={!next}
              onClick={() => void rt.takeNext()}
            >
              {t('live.takeNext')}
            </Button>
          </div>
        </section>

        <section className={s.col} aria-label={t('live.rundown')}>
          <div className={s.overlineRow}>
            <span className="rs-overline">{t('live.rundown')}</span>
            <span className="rs-overline">
              {st.onAirIndex !== null
                ? `${st.onAirIndex + 1} / ${st.rundown.length}`
                : `– / ${st.rundown.length}`}
            </span>
          </div>
          <ol className={s.rundown}>
            {st.rundown.map((r, i) => {
              const onAir = i === st.onAirIndex && st.scene !== 'camera' && st.scene !== 'slate';
              const isNext = i === nextIdx;
              const past = st.onAirIndex !== null && i < st.onAirIndex;
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    className={cx(s.rItem, onAir && s.rOnAir, isNext && s.rNext, past && s.rPast)}
                    onClick={() => void rt.takeItem(i)}
                  >
                    <span className="rs-mono">{String(i + 1).padStart(2, '0')}</span>
                    <span className={s.rText}>
                      <span className={s.rTitle}>{r.title}</span>
                      {(onAir || isNext) && (
                        <span className={s.rSub}>
                          {typeLabel(r.type)} · {onAir ? t('live.onScreen') : t('live.nextShort')}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
          <Button size="dense" variant="ghost" onClick={() => router.go('/studio')}>
            {t('live.editRundown')}
          </Button>
        </section>
      </main>

      <footer className={s.bottom}>
        <div className={s.panel}>
          <div className={s.overlineRow}>
            <span className="rs-overline">{t('live.audio')}</span>
            <span className="rs-mono">
              {audio.status === 'running'
                ? `${Math.round(Math.max(...audio.programme.holdDb))} dB`
                : '—'}
            </span>
          </div>
          <Meter
            level={meterPosition(audio.programme.holdDb[0])}
            label={t('audio.meter', { ch: 'L' })}
            marker={0.9}
          />
          <Meter
            level={meterPosition(audio.programme.holdDb[1])}
            label={t('audio.meter', { ch: 'R' })}
            marker={0.9}
          />
          <div className={s.chips}>
            <button
              type="button"
              className={s.chip}
              aria-pressed={audio.hpf}
              onClick={() => rt.audio.setHpf(!audio.hpf)}
            >
              <StatusDot tone={audio.hpf ? 'accent' : 'off'} size={8} />
              {t('audio.lowCut')}
            </button>
            <button
              type="button"
              className={s.chip}
              aria-pressed={audio.compressor}
              onClick={() => rt.audio.setCompressor(!audio.compressor)}
            >
              <StatusDot tone={audio.compressor ? 'accent' : 'off'} size={8} />
              {t('audio.compressor')}
            </button>
            <button
              type="button"
              className={cx(s.chip, audio.muted && s.chipMuted)}
              aria-pressed={audio.muted}
              onClick={() => rt.audio.setMuted(!audio.muted)}
            >
              {audio.muted ? t('live.muted') : t('live.mute')}
            </button>
            <button
              type="button"
              className={s.chip}
              aria-pressed={audio.monitor}
              title={t('audio.listenDesc')}
              onClick={() => rt.audio.setMonitor(!audio.monitor)}
            >
              <StatusDot tone={audio.monitor ? 'accent' : 'off'} size={8} />
              {t('audio.listen')}
            </button>
          </div>
          {audio.status === 'device_lost' && (
            <div className={s.alert}>
              {audio.source === 'phone' ? t('audio.phoneLost') : t('audio.deviceLost')}
            </div>
          )}
          {audio.deviceBack && (
            <Button size="dense" variant="primary" onClick={() => void rt.reconnectAudio()}>
              {t('audio.deviceBack', { label: audio.deviceBack.label })}
            </Button>
          )}
          {audio.silent && (
            <div className={s.alert}>
              {t('audio.silent')}{' '}
              <Button size="dense" onClick={() => rt.audio.acknowledgeSilence()}>
                {t('audio.silentIntentional')}
              </Button>
            </div>
          )}
        </div>
        <div className={s.panel}>
          <span className="rs-overline">{t('live.destinations')}</span>
          <DestinationRows />
          <div className={s.destRow}>
            <StatusDot tone={sending ? 'ready' : 'off'} />
            <b>{t('live.privateTestServer')}</b>
            <span className="rs-mono">
              {sending
                ? t('live.receiving')
                : st.contribution === 'error'
                  ? t('live.failed', { code: st.contributionError ?? '' })
                  : t('live.off')}
            </span>
          </div>
        </div>
        <div className={cx(s.panel, s.health)}>
          <span className="rs-overline" style={{ gridColumn: '1 / -1' }}>
            {t('live.health')}
          </span>
          <HealthNotes now={now} />
          <div>
            <div className={s.hLabel}>{t('health.uplink')}</div>
            <div className={s.hValue}>
              {upBps != null ? `${(upBps / 1e6).toFixed(1)} Mb/s` : '—'}
            </div>
          </div>
          <div>
            <div className={s.hLabel}>{t('health.toServer')}</div>
            <div className={s.hValue}>
              {whip?.rttMs != null ? `${Math.round(whip.rttMs)} ms` : '—'}
            </div>
          </div>
          <div>
            <div className={s.hLabel}>{t('health.laptop')}</div>
            <div className={s.hValue} title={t('health.inferred')}>
              {laptop}
            </div>
          </div>
          <div>
            <div className={s.hLabel}>{t('health.camera')}</div>
            <div className={s.hValue}>
              {cam.summary?.fps != null ? `${Math.round(cam.summary.fps)} fps` : '—'} ·{' '}
              {t(`route.short.${cam.route}` as never)}
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

const NULL_STORE = { subscribe: () => () => {}, snapshot: null };

/**
 * What the automatic quality steps did (SPEC §11.5), and whether the media server's status is fresh
 * (SPEC §9.3: stale after 5 s without an update while sending).
 */
function HealthNotes({ now }: { now: number }) {
  const rt = studioRuntime();
  const st = useStore(rt);
  const notes: string[] = [];
  const q = st.quality;
  if (q.upload > 0)
    notes.push(
      t('health.uploadReduced', {
        mbps: (UPLOAD_STEPS[st.profile][q.upload]! / 1e6).toFixed(1),
      }),
    );
  if (q.cpu > 0) notes.push(t('health.cpuReduced'));
  if (q.camera > 0) notes.push(t('health.cameraReduced', { mbps: CAMERA_STEPS[q.camera]! / 1e6 }));
  const updated = st.observed?.updatedAt ? Date.parse(st.observed.updatedAt) : null;
  const age = updated ? Math.round((now - updated) / 1000) : null;
  if (rt.isLive && age !== null && age > 5) notes.push(t('health.stale', { s: age }));
  if (notes.length === 0) return null;
  return (
    <div className={s.healthNotes} style={{ gridColumn: '1 / -1' }} role="status">
      {notes.map((n) => (
        <div key={n}>{n}</div>
      ))}
    </div>
  );
}
