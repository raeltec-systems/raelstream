import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Banner, Button, Card, Segmented, StatusRow } from '@raelstream/ui';
import { t } from '@raelstream/i18n';
import type { RouteLabel } from '@raelstream/media-runtime';
import { useStore } from '../../lib/useStore.js';
import { studioRuntime, type Profile } from '../runtime.js';
import { CapabilityChecks } from './CapabilityChecks.js';
import s from './steps.module.css';

export const ROUTE_TEXT: Record<RouteLabel, string> = {
  direct_verified: 'route.directVerified',
  direct_unverified: 'route.directUnverified',
  relayed: 'route.relayed',
  unknown: 'route.unknown',
};

function useCountdown(until: string | null): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!until) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [until]);
  return until ? Math.max(0, Math.round((Date.parse(until) - now) / 1000)) : 0;
}

export function DevicesStep() {
  const rt = studioRuntime();
  const st = useStore(rt);
  const cam = useStore(rt.camera);
  const audio = useStore(rt.audio);
  const src = st.session?.sources[0] ?? null;
  const present = !!src && !!st.cameraPresent[src.id];
  const cameraOk = cam.connection === 'connected';
  const res = cam.summary?.height ? `${cam.summary.height}p` : '—';

  return (
    <>
      <h1 className="rs-h1">{t('devices.title')}</h1>
      <div className={s.grid2}>
        <Card ring={src?.status === 'pending' ? 'standby' : undefined}>
          <div className={s.head}>
            <div className={s.tile}>{t('devices.camTile')}</div>
            <div className={s.headText}>
              <div className={s.headTitle}>{src?.label ?? t('devices.camera')}</div>
              <div className={s.headSub}>{src ? src.deviceHint : t('devices.cameraHint')}</div>
            </div>
          </div>
          {!src && <PairPanel />}
          {src?.status === 'pending' && (
            <PendingPanel
              sourceId={src.id}
              phrase={src.verificationPhrase}
              present={!!st.cameraPresent[src.id]}
            />
          )}
          {src?.status === 'admitted' && (
            <>
              {!present && <ReconnectPanel />}
              <CameraPreview />
              <StatusRow
                tone={cameraOk ? 'ready' : cam.connection === 'idle' ? 'off' : 'standby'}
                label={
                  cameraOk
                    ? t('devices.connected')
                    : cam.connection === 'idle'
                      ? t('devices.waitingForStart')
                      : t('devices.connecting')
                }
                detail={
                  cam.summary?.rttMs != null
                    ? t('units.rtt', { ms: Math.round(cam.summary.rttMs) })
                    : undefined
                }
              />
              <StatusRow
                tone={
                  cam.route === 'direct_verified'
                    ? 'ready'
                    : cam.route === 'relayed'
                      ? 'live'
                      : 'standby'
                }
                label={t(ROUTE_TEXT[cam.route] as never)}
              />
              <StatusRow
                tone={cameraOk ? 'ready' : 'off'}
                label={t('devices.received')}
                detail={
                  cameraOk
                    ? `${res} · ${cam.summary?.fps != null ? Math.round(cam.summary.fps) : '—'} fps · ${cam.summary?.codec?.replace('video/', '') ?? '—'}`
                    : '—'
                }
              />
              {cameraOk && cam.summary?.fps != null && cam.summary.fps < 24 && (
                <p className={s.warn}>
                  {t('devices.lowFps', { fps: Math.round(cam.summary.fps) })}
                </p>
              )}
              <div className={s.row}>
                <Button size="dense" onClick={() => void rt.revoke(src.id)}>
                  {t('devices.removeCamera')}
                </Button>
              </div>
            </>
          )}
        </Card>
        <Card>
          <div className={s.headTitle}>{t('devices.programmeSize')}</div>
          <Segmented<Profile>
            label={t('devices.programmeSize')}
            value={st.profile}
            onChange={(p) => rt.setProfile(p)}
            options={[
              { value: 'reliable_hd', label: '720p', grow: 1.6 },
              { value: 'full_hd', label: '1080p' },
            ]}
          />
          <p className={s.muted}>{t('devices.profileNote')}</p>
          <div className={s.headTitle}>{t('devices.framing')}</div>
          <Segmented<'contain' | 'fill'>
            label={t('devices.framing')}
            value={st.framing}
            onChange={(f) => void rt.setFraming(f)}
            options={[
              { value: 'contain', label: t('devices.framingFit') },
              { value: 'fill', label: t('devices.framingFill') },
            ]}
          />
          <p className={s.muted}>{t('devices.framingNote')}</p>
        </Card>
      </div>
      {cam.directLinkFailed && present && (
        <Banner
          title={t('directFail.title')}
          actions={
            present && (
              <Button
                size="dense"
                variant="primary"
                disabled={!st.lease?.mine}
                onClick={() => void rt.retryCamera()}
              >
                {t('directFail.retry')}
              </Button>
            )
          }
        >
          {t('directFail.body', { ssid: st.productionSsid || t('directFail.productionWifi') })}
        </Banner>
      )}
      <CapabilityChecks
        cameraOk={cameraOk}
        audioOk={audio.status === 'running'}
        cameraDetail={cameraOk ? res : ''}
        audioDetail={audio.deviceLabel?.slice(0, 18) ?? ''}
      />
    </>
  );
}

/**
 * The phone left (Back, browser closed, battery swap). It normally comes back by itself when its page
 * is reopened; if not, the same phone scans this code and takes its place again without being let in
 * a second time. A different phone is refused until this camera is removed.
 */
export function ReconnectPanel() {
  const rt = studioRuntime();
  const st = useStore(rt);
  const [open, setOpen] = useState(false);
  return (
    <div className={s.reconnect} data-testid="reconnect-panel">
      <p className={s.warn}>{t('reconnect.away')}</p>
      {open ? (
        <PairPanel reconnect />
      ) : (
        <div className={s.row}>
          <Button
            size="dense"
            variant="primary"
            disabled={!st.lease?.mine}
            onClick={() => {
              setOpen(true);
              void rt.createInvitation();
            }}
          >
            {t('reconnect.show')}
          </Button>
        </div>
      )}
    </div>
  );
}

function PairPanel({ reconnect = false }: { reconnect?: boolean }) {
  const rt = studioRuntime();
  const st = useStore(rt);
  const [qr, setQr] = useState<string | null>(null);
  const left = useCountdown(st.invitation?.expiresAt ?? null);
  useEffect(() => {
    if (!st.invitation) return setQr(null);
    void QRCode.toDataURL(st.invitation.url, {
      margin: 1,
      width: 400,
      errorCorrectionLevel: 'M',
    }).then(setQr);
  }, [st.invitation]);
  if (!st.invitation || left === 0) {
    return (
      <div className={s.row}>
        <Button
          variant="primary"
          disabled={!st.lease?.mine}
          onClick={() => void rt.createInvitation()}
        >
          {st.invitation ? t('pair.newCode') : t('pair.show')}
        </Button>
        {st.invitation && <span className={s.muted}>{t('pair.expired')}</span>}
      </div>
    );
  }
  return (
    <div className={s.qr}>
      {qr && (
        <img src={qr} alt={t('pair.qrAlt')} data-testid="pair-qr" data-url={st.invitation.url} />
      )}
      <div className={s.meters}>
        <div className={s.headTitle}>{reconnect ? t('reconnect.scan') : t('pair.scan')}</div>
        <p className={s.muted}>
          {reconnect
            ? t('reconnect.instructions')
            : t('pair.instructions', { ssid: st.productionSsid || t('directFail.productionWifi') })}
        </p>
        <div className={s.mono}>{t('pair.expiresIn', { s: left })}</div>
        <div className={s.row}>
          <Button size="dense" onClick={() => void rt.createInvitation()}>
            {t('pair.newCode')}
          </Button>
        </div>
      </div>
    </div>
  );
}

function PendingPanel({
  sourceId,
  phrase,
  present,
}: {
  sourceId: string;
  phrase: string;
  present: boolean;
}) {
  const rt = studioRuntime();
  return (
    <>
      <p className={s.muted}>{t('pending.compare')}</p>
      <div className={s.phrase} data-testid="studio-phrase">
        {phrase}
      </div>
      {!present && <p className={s.warn}>{t('pending.phoneAway')}</p>}
      <div className={s.row}>
        <Button variant="primary" onClick={() => void rt.admit(sourceId)}>
          {t('pending.admit')}
        </Button>
        <Button onClick={() => void rt.reject(sourceId)}>{t('pending.reject')}</Button>
      </div>
    </>
  );
}

export function CameraPreview({ className }: { className?: string }) {
  const rt = studioRuntime();
  useStore(rt.camera);
  const ref = useRef<HTMLVideoElement>(null);
  const stream = rt.camera.stream;
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream;
  }, [stream]);
  return (
    <video
      ref={ref}
      className={className ?? s.preview}
      muted
      playsInline
      autoPlay
      data-testid="camera-preview"
    />
  );
}
