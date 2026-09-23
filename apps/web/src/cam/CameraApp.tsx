import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { PreviewResponse, ClaimResponse, ServerMessage } from '@raelstream/contracts';
import { CameraSender, type CaptureError } from '@raelstream/camera-client';
import { Button, Segmented, StatusRow, TextField, Logo, cx } from '@raelstream/ui';
import { t, type MessageKey } from '@raelstream/i18n';
import { api, ApiFailure } from '../lib/api.js';
import { SessionSocket } from '../lib/ws.js';
import s from './CameraApp.module.css';

type Phase =
  | { k: 'loading' }
  | { k: 'invalid' }
  | { k: 'join'; token: string; preview: PreviewResponse }
  | { k: 'pending'; phrase: string }
  | { k: 'admitted' }
  | { k: 'live' }
  | { k: 'ended'; reason: 'rejected' | 'revoked' };

const CRED_KEY = 'rs.cam.cred';
const DEVICE_KEY = 'rs.cam.device';

function deviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      const b = crypto.getRandomValues(new Uint8Array(16));
      id = btoa(String.fromCharCode(...b))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    const b = crypto.getRandomValues(new Uint8Array(16));
    return btoa(String.fromCharCode(...b))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }
}

function saveCred(c: { credential: string; phrase?: string }) {
  try {
    sessionStorage.setItem(CRED_KEY, JSON.stringify(c));
  } catch {
    /* ignore */
  }
}
function loadCred(): { credential: string; phrase?: string } | null {
  try {
    return JSON.parse(sessionStorage.getItem(CRED_KEY) ?? 'null');
  } catch {
    return null;
  }
}

const CAPTURE_ERR: Record<CaptureError, MessageKey> = {
  CAM_PERMISSION_DENIED: 'cam.err.permission',
  CAM_IN_USE: 'cam.err.inUse',
  CAM_NOT_FOUND: 'cam.err.notFound',
  CAM_UNSUPPORTED: 'cam.err.unsupported',
};

export function CameraApp() {
  const [phase, setPhase] = useState<Phase>({ k: 'loading' });
  const [label, setLabel] = useState(t('cam.defaultLabel'));
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<SessionSocket | null>(null);
  const credRef = useRef<{ credential: string; phrase?: string } | null>(null);
  const sender = useMemo(
    () =>
      new CameraSender((payload) => {
        const cred = credRef.current;
        if (cred && sourceIdRef.current)
          socketRef.current?.send({ type: 'signal', sourceId: sourceIdRef.current, payload });
      }),
    [],
  );
  const sourceIdRef = useRef<string | null>(null);
  const snd = useSyncExternalStore(sender.subscribe, () => sender.state);

  useEffect(() => {
    // PAIR-02: read the fragment secret, then clear it from the address bar and history immediately.
    const m = /^#t=([A-Za-z0-9_-]{43})$/.exec(location.hash);
    if (m) history.replaceState(null, '', location.pathname);
    const token = m?.[1];
    const existing = loadCred();
    if (!token && existing) {
      credRef.current = existing;
      openSocket(existing.credential);
      return;
    }
    if (!token) return setPhase({ k: 'invalid' });
    api<PreviewResponse>('POST', '/api/pairings/preview', { token })
      .then((preview) => setPhase({ k: 'join', token, preview }))
      .catch(() => setPhase({ k: 'invalid' }));
    return () => socketRef.current?.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pairing bootstrap runs once per page load
  }, []);

  function onServer(m: ServerMessage) {
    switch (m.type) {
      case 'welcome':
        sourceIdRef.current = m.sourceId ?? null;
        if (m.sourceStatus === 'admitted')
          setPhase((p) => (p.k === 'live' ? p : { k: 'admitted' }));
        else setPhase({ k: 'pending', phrase: credRef.current?.phrase ?? '' });
        break;
      case 'admitted':
        credRef.current = { credential: m.credential, phrase: credRef.current?.phrase };
        saveCred(credRef.current);
        setPhase((p) => (p.k === 'live' ? p : { k: 'admitted' }));
        break;
      case 'rejected':
      case 'revoke':
        sender.stop();
        try {
          sessionStorage.removeItem(CRED_KEY);
        } catch {
          /* ignore */
        }
        setPhase({ k: 'ended', reason: m.type === 'rejected' ? 'rejected' : 'revoked' });
        break;
      case 'signal':
        void sender.onSignal(m.payload);
        break;
      case 'tally':
        sender.setTally(m.state);
        break;
      case 'studio.changed':
        void sender.renegotiate();
        break;
      default:
        break;
    }
  }

  function openSocket(credential: string) {
    socketRef.current?.close();
    const sock = new SessionSocket(
      () => ({
        type: 'hello',
        role: 'camera',
        credential: credRef.current?.credential ?? credential,
      }),
      onServer,
    );
    sock.onStatus = (st, code) => {
      if (st === 'closed' && (code === 4403 || code === 4401)) {
        sender.stop();
        setPhase({ k: 'ended', reason: 'revoked' });
      }
    };
    socketRef.current = sock;
  }

  async function join(token: string) {
    setError(null);
    try {
      const r = await api<ClaimResponse>('POST', '/api/pairings/claim', {
        token,
        deviceId: deviceId(),
        label: label.trim() || t('cam.defaultLabel'),
      });
      credRef.current = { credential: r.credential, phrase: r.verificationPhrase };
      sourceIdRef.current = r.sourceId;
      saveCred(credRef.current);
      setPhase({ k: 'pending', phrase: r.verificationPhrase });
      openSocket(r.credential);
    } catch (e) {
      if (e instanceof ApiFailure && (e.status === 410 || e.status === 409)) setError(e.message);
      else setError(t('cam.joinFailed'));
    }
  }

  async function start() {
    await sender.start();
    if (sender.state.capture === 'live') setPhase({ k: 'live' });
  }

  if (phase.k === 'live' && snd.capture === 'live')
    return <LiveCamera sender={sender} label={label} />;

  return (
    <main className={s.page} data-theme="dark">
      <Logo ring={18} />
      {phase.k === 'loading' && <p className={s.muted}>{t('cam.loading')}</p>}
      {phase.k === 'invalid' && (
        <section className={s.card}>
          <h1 className={s.title}>{t('cam.invalidTitle')}</h1>
          <p className={s.muted}>{t('cam.invalidBody')}</p>
        </section>
      )}
      {phase.k === 'join' && (
        <section className={s.card}>
          <span className={s.badge}>{t('cam.cameraOnly')}</span>
          <h1 className={s.title}>{phase.preview.serviceName}</h1>
          <p className={s.muted}>{t('cam.videoOnly')}</p>
          <TextField
            label={t('cam.labelField')}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={40}
            error={error}
          />
          <Button variant="primary" className={s.big} onClick={() => void join(phase.token)}>
            {t('cam.join')}
          </Button>
        </section>
      )}
      {phase.k === 'pending' && (
        <section className={s.card}>
          <h1 className={s.title}>{t('cam.waitingTitle')}</h1>
          <p className={s.muted}>{t('cam.waitingBody')}</p>
          <div className={s.phrase} data-testid="cam-phrase">
            {phase.phrase}
          </div>
        </section>
      )}
      {phase.k === 'admitted' && (
        <section className={s.card}>
          <span className={s.badge}>{t('cam.cameraOnly')}</span>
          <h1 className={s.title}>{t('cam.admittedTitle')}</h1>
          <p className={s.muted}>{t('cam.permissionExplain')}</p>
          {snd.captureError && (
            <p className={s.error} role="alert">
              {t(CAPTURE_ERR[snd.captureError])}
            </p>
          )}
          <Button
            variant="primary"
            className={s.big}
            onClick={() => void start()}
            disabled={snd.capture === 'starting'}
          >
            {snd.captureError ? t('cam.tryAgain') : t('cam.start')}
          </Button>
        </section>
      )}
      {phase.k === 'ended' && (
        <section className={s.card}>
          <h1 className={s.title}>
            {phase.reason === 'rejected' ? t('cam.rejectedTitle') : t('cam.removedTitle')}
          </h1>
          <p className={s.muted}>{t('cam.endedBody')}</p>
        </section>
      )}
    </main>
  );
}

function LiveCamera({ sender, label }: { sender: CameraSender; label: string }) {
  const snd = useSyncExternalStore(sender.subscribe, () => sender.state);
  const video = useRef<HTMLVideoElement>(null);
  const [confirmStop, setConfirmStop] = useState(false);
  const [portrait, setPortrait] = useState(false);
  useEffect(() => {
    if (video.current) video.current.srcObject = sender.previewStream;
  }, [sender, snd.info]);
  useEffect(() => {
    const check = () => setPortrait(window.innerHeight > window.innerWidth);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  const tallyWord =
    snd.tally === 'live'
      ? t('cam.tally.live')
      : snd.connection === 'connected'
        ? t('cam.tally.ready')
        : snd.connection === 'failed' || snd.connection === 'disconnected'
          ? t('cam.tally.reconnecting')
          : t('cam.tally.connecting');
  const tone = snd.tally === 'live' ? 'live' : snd.connection === 'connected' ? 'ready' : 'standby';
  const zoom = snd.info?.zoom;
  const zoomOptions = zoom ? [0.5, 1, 2].filter((z) => z >= zoom.min && z <= zoom.max) : [];
  const qualityKey: Record<typeof snd.quality, MessageKey> = {
    good: 'cam.q.good',
    reduced: 'cam.q.reduced',
    unstable: 'cam.q.unstable',
    disconnected: 'cam.q.disconnected',
  };

  return (
    <main className={cx(s.live, s[`tally_${tone}`])} data-theme="dark">
      <video ref={video} className={s.video} muted playsInline autoPlay />
      <div className={s.topBar}>
        <div className={cx(s.tally, s[`tallyPill_${tone}`])} role="status" data-testid="cam-tally">
          <span className={s.tallyDot} />
          {tallyWord}
        </div>
        <div className={s.camChip}>{label}</div>
      </div>
      {portrait && (
        <div className={s.rotate} role="alert">
          {t('cam.rotate')}
        </div>
      )}
      <div className={s.sheet}>
        {zoomOptions.length > 1 && (
          <Segmented<string>
            label={t('cam.zoom')}
            height={52}
            value={String(zoom!.value)}
            onChange={(v) => void sender.setZoom(Number(v))}
            options={zoomOptions.map((z) => ({ value: String(z), label: `${z}×` }))}
          />
        )}
        <StatusRow
          tone={snd.connection === 'connected' ? 'ready' : 'standby'}
          label={snd.connection === 'connected' ? t('cam.connected') : t('cam.notConnected')}
          detail={snd.rttMs != null ? t('units.rtt', { ms: Math.round(snd.rttMs) }) : undefined}
        />
        <StatusRow
          tone={
            snd.quality === 'good' ? 'ready' : snd.quality === 'disconnected' ? 'live' : 'standby'
          }
          label={t(qualityKey[snd.quality])}
          detail={snd.info?.actual.height ? `${snd.info.actual.height}p` : undefined}
        />
        <StatusRow
          tone={
            snd.battery
              ? snd.battery.level < 0.15 && !snd.battery.charging
                ? 'standby'
                : 'ready'
              : 'off'
          }
          label={
            snd.battery
              ? snd.battery.charging
                ? t('cam.batteryCharging')
                : t('cam.battery')
              : t('cam.batteryUnavailable')
          }
          detail={snd.battery ? `${Math.round(snd.battery.level * 100)}%` : undefined}
        />
        <p className={s.note}>
          {snd.wakeLock === 'active' ? t('cam.keepOpen') : t('cam.keepOpenNoLock')}
        </p>
        {confirmStop ? (
          <div className={s.stopRow}>
            <Button onClick={() => setConfirmStop(false)}>{t('cam.keepFilming')}</Button>
            <Button variant="destructive" onClick={() => sender.stop()}>
              {t('cam.stopConfirm')}
            </Button>
          </div>
        ) : (
          <Button variant="dangerTrigger" onClick={() => setConfirmStop(true)}>
            {t('cam.stop')}
          </Button>
        )}
      </div>
    </main>
  );
}
