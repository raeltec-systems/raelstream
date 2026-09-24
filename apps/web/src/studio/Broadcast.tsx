import { useEffect, useRef, useState } from 'react';
import type { DestinationSummary, ObservedDestination } from '@raelstream/contracts';
import { Banner, Button, Modal, Pill, StatusDot, StopModal, type Tone } from '@raelstream/ui';
import { t, type MessageKey } from '@raelstream/i18n';
import { api } from '../lib/api.js';
import { useStore } from '../lib/useStore.js';
import { LIVE_STATES, PROFILE_SIZE, studioRuntime } from './runtime.js';
import s from './Live.module.css';

export function fmtElapsed(sinceMs: number | null, now: number): string {
  if (!sinceMs) return '00:00';
  const sec = Math.max(0, Math.floor((now - sinceMs) / 1000));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const p = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(sec % 60)}` : `${p(m)}:${p(sec % 60)}`;
}

export function platformName(d: DestinationSummary): string {
  return d.platform === 'facebook' ? t('platform.facebook') : t('platform.youtube');
}

function earliestSending(obs: Record<string, ObservedDestination> | undefined): number | null {
  const ts = Object.values(obs ?? {})
    .map((d) => (d.sendingSince ? Date.parse(d.sendingSince) : NaN))
    .filter(Number.isFinite);
  return ts.length ? Math.min(...ts) : null;
}

/** Session pill (design: Live states), driven only by supervisor-observed state (B§10.4). */
export function SessionPill({
  now,
  cameraDropped,
  cameraReconnecting,
}: {
  now: number;
  cameraDropped: boolean;
  cameraReconnecting: boolean;
}) {
  const st = useStore(studioRuntime());
  const lc = st.lifecycle;
  if (lc === 'RECOVERING') {
    const ends = st.observed?.fallback.graceEndsAt
      ? Date.parse(st.observed.fallback.graceEndsAt)
      : null;
    const left = ends ? Math.max(0, Math.round((ends - now) / 1000)) : null;
    return (
      <Pill tone="standby">
        {t('pill.slateOn', {
          left:
            left === null ? '—' : `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`,
        })}
      </Pill>
    );
  }
  if (lc === 'STARTING') return <Pill tone="standby">{t('pill.starting')}</Pill>;
  if (lc === 'STOPPING') return <Pill tone="standby">{t('pill.stopping')}</Pill>;
  if (lc === 'SENDING' || lc === 'PARTIAL') {
    if (cameraDropped) return <Pill tone="standby">{t('pill.cameraDropped')}</Pill>;
    if (cameraReconnecting) return <Pill tone="standby">{t('pill.reconnectingCamera')}</Pill>;
    return (
      <Pill tone="live">
        {t('pill.onAir')}
        <span className="rs-mono">
          {fmtElapsed(earliestSending(st.observed?.destinations), now)}
        </span>
      </Pill>
    );
  }
  if (st.contribution === 'sending')
    return (
      <Pill tone="off">
        {t('pill.privateTest')}
        <span className="rs-mono">{fmtElapsed(st.sendingSince, now)}</span>
      </Pill>
    );
  return <Pill tone="off">{t('pill.offAir')}</Pill>;
}

const DEST_TONE: Record<string, Tone> = {
  SENDING: 'ready',
  LIVE_CONFIRMED: 'ready',
  CONNECTING: 'standby',
  RECONNECTING: 'standby',
  READY_UNVERIFIED: 'off',
  STOPPED: 'off',
  FAILED: 'live',
  NOT_CONFIGURED: 'off',
};
const FAILURE_KEY: Record<string, MessageKey> = {
  DEST_AUTH_REJECTED: 'dest.fail.auth',
  DEST_MEDIA_REJECTED: 'dest.fail.media',
  DEST_NETWORK: 'dest.fail.network',
  DEST_URL_NOT_ALLOWED: 'dest.fail.url',
  DEST_ADDRESS_NOT_PUBLIC: 'dest.fail.url',
  DEST_KEY_MISSING: 'dest.fail.key',
};

/** One row per destination: dot + platform + honest sub-status (+ Fix/Retry). SENDING ≠ publicly live (B§16.3). */
export function DestinationRows() {
  const rt = studioRuntime();
  const st = useStore(rt);
  if (st.destinations.length === 0)
    return <div className={s.destEmpty}>{t('dest.noneConfigured')}</div>;
  return (
    <>
      {st.destinations.map((d) => {
        const o = st.observed?.destinations[d.id];
        const inBroadcast = rt.isLive && st.liveDestinationIds.includes(d.id);
        const state = inBroadcast ? (o?.state ?? 'CONNECTING') : 'READY_UNVERIFIED';
        let sub: string;
        if (!inBroadcast) sub = t('dest.ready', { last4: d.keyLast4 ?? '----' });
        else if (state === 'SENDING' && d.autoPublishesOnIngest === 'no')
          sub = d.platform === 'youtube' ? t('dest.receivingYoutube') : t('dest.receiving');
        else if (state === 'SENDING')
          sub = o?.bitrateKbps
            ? t('dest.sendingRate', { mbps: (o.bitrateKbps / 1000).toFixed(1) })
            : t('dest.sending');
        else if (state === 'RECONNECTING') sub = t('dest.reconnecting', { n: o?.attempts ?? 1 });
        else if (state === 'FAILED')
          sub = t(FAILURE_KEY[o?.failure ?? 'DEST_NETWORK'] ?? 'dest.fail.network', {
            platform: platformName(d),
          });
        else if (state === 'STOPPED') sub = t('dest.stopped');
        else sub = t('dest.connecting');
        return (
          <div key={d.id} className={s.destRow} data-testid={`dest-${d.platform}`}>
            <StatusDot tone={DEST_TONE[state] ?? 'off'} />
            <span className={s.destText}>
              <b>{platformName(d)}</b>
              <span className={state === 'FAILED' ? s.destFail : s.destSub}>{sub}</span>
            </span>
            {inBroadcast && state === 'SENDING' && d.watchUrl && (
              <a className={s.destLink} href={d.watchUrl} target="_blank" rel="noreferrer noopener">
                {t('dest.openPlatform')}
              </a>
            )}
            {inBroadcast && state === 'SENDING' && (
              <LiveConfirmation d={d} sendingSince={o?.sendingSince ?? null} />
            )}
            {inBroadcast &&
              state === 'FAILED' &&
              d.keyMode === 'per_event' &&
              (o?.failure === 'DEST_AUTH_REJECTED' || o?.failure === 'DEST_KEY_MISSING') && (
                <Button
                  size="dense"
                  variant="ghost"
                  onClick={async () => {
                    const key = window.prompt(t('dest.fixKeyPrompt'));
                    if (!key?.trim()) return;
                    await rt
                      .pasteSessionKey(d.id, key.trim())
                      .then(() => rt.retryDestination(d.id))
                      .catch((e) => rt.reportError(e));
                  }}
                >
                  {t('dest.fixKey')}
                </Button>
              )}
            {inBroadcast && (state === 'FAILED' || state === 'RECONNECTING') && (
              <Button size="dense" variant="ghost" onClick={() => void rt.retryDestination(d.id)}>
                {t('dest.retry')}
              </Button>
            )}
          </div>
        );
      })}
    </>
  );
}

/**
 * "I've checked the platform playback" (SPEC §13.4): the only way a destination shows as confirmed
 * live. A confirmation from before the latest reconnect no longer counts. Viewer counts are never shown.
 */
function LiveConfirmation({
  d,
  sendingSince,
}: {
  d: DestinationSummary;
  sendingSince: string | null;
}) {
  const rt = studioRuntime();
  const st = useStore(rt);
  const c = st.sessionDestinations.find((x) => x.destinationId === d.id)?.liveConfirmation;
  const valid = c && (!sendingSince || Date.parse(c.at) >= Date.parse(sendingSince));
  if (!valid)
    return (
      <Button size="dense" variant="ghost" onClick={() => void rt.confirmLive(d.id)}>
        {t('dest.confirm')}
      </Button>
    );
  const mins = Math.floor((Date.now() - Date.parse(c.at)) / 60_000);
  return (
    <span className={s.destSub} data-testid={`confirmed-${d.platform}`}>
      {mins >= 30 ? t('dest.checkedAgo', { n: mins }) : t('dest.checked', { by: c.by })}
    </span>
  );
}

/** The owner's private recording of this service, if one was made (SPEC §12.7). */
function Recordings() {
  const st = useStore(studioRuntime());
  const [files, setFiles] = useState<Array<{ name: string; bytes: number; url: string }>>([]);
  const [open, setOpen] = useState(false);
  const close = useRef<HTMLButtonElement>(null);
  const id = st.session?.id;
  useEffect(() => {
    if (!id) return;
    // Owner only: an operator gets 403 and sees nothing.
    void api<typeof files>('GET', `/api/sessions/${id}/recordings`)
      .then(setFiles)
      .catch(() => setFiles([]));
  }, [id]);
  if (files.length === 0) return null;
  return (
    <>
      <Button size="dense" onClick={() => setOpen(true)}>
        {t('rec.open', { n: files.length })}
      </Button>
      {open && (
        <Modal
          title={t('rec.title')}
          onDismiss={() => setOpen(false)}
          initialFocus={close}
          actions={
            <Button ref={close} onClick={() => setOpen(false)}>
              {t('rec.close')}
            </Button>
          }
        >
          <p className={s.goMeta}>{t('rec.body')}</p>
          <ul className={s.goList}>
            {files.map((f) => (
              <li key={f.url} className={s.goRow}>
                <a className={s.destLink} href={f.url} download>
                  {f.name}
                </a>
                <span className={s.goMeta}>
                  {t('rec.size', { gb: (f.bytes / 1e9).toFixed(2) })}
                </span>
              </li>
            ))}
          </ul>
        </Modal>
      )}
    </>
  );
}

/** Persistent banners for partial publication and the fallback slate (SPEC §13.5, §12.5). */
export function BroadcastBanners() {
  const st = useStore(studioRuntime());
  if (st.lifecycle === 'ENDED' || st.lifecycle === 'INTERRUPTED') {
    return (
      <Banner
        compact
        tone="standby"
        title={st.lifecycle === 'ENDED' ? t('banner.endedTitle') : t('banner.interruptedTitle')}
        actions={
          <>
            <Recordings />
            {st.session && (
              <Button
                size="dense"
                onClick={() => window.location.assign(`/studio/report/${st.session!.id}`)}
              >
                {t('banner.viewReport')}
              </Button>
            )}
            <Button
              size="dense"
              variant="primary"
              onClick={() => window.location.assign('/studio')}
            >
              {t('banner.newService')}
            </Button>
          </>
        }
      >
        {t('banner.endedBody')}
      </Banner>
    );
  }
  if (st.lifecycle === 'RECOVERING') {
    return (
      <Banner
        compact
        tone="standby"
        title={t('banner.slateTitle')}
        actions={
          st.lease?.mine && (
            <Button size="dense" onClick={() => void studioRuntime().extendGrace()}>
              {t('banner.extendGrace')}
            </Button>
          )
        }
      >
        {t('banner.slateBody')}
      </Banner>
    );
  }
  if (st.lifecycle === 'PARTIAL') {
    const ok = st.destinations
      .filter((d) => st.observed?.destinations[d.id]?.state === 'SENDING')
      .map(platformName);
    const bad = st.destinations
      .filter(
        (d) =>
          st.liveDestinationIds.includes(d.id) &&
          st.observed?.destinations[d.id]?.state !== 'SENDING',
      )
      .map(platformName);
    return (
      <Banner compact tone="standby" title={t('banner.partialTitle', { ok: ok.join(', ') || '—' })}>
        {t('banner.partialBody', { bad: bad.join(', ') })}
      </Banner>
    );
  }
  if (st.commandError)
    return (
      <Banner compact title={t('banner.commandFailed')}>
        {st.commandError}
      </Banner>
    );
  return null;
}

/** Top-bar broadcast action: Go live… (primary) or Stop streaming… (outlined red trigger). */
export function BroadcastAction({ now }: { now: number }) {
  const rt = studioRuntime();
  const st = useStore(rt);
  const [modal, setModal] = useState<'go' | 'stop' | null>(null);
  const live = !!st.lifecycle && LIVE_STATES.includes(st.lifecycle);
  const ended = st.lifecycle === 'ENDED' || st.lifecycle === 'INTERRUPTED';
  const liveDests = st.destinations.filter((d) => st.liveDestinationIds.includes(d.id));
  return (
    <>
      {live ? (
        <Button
          size="top"
          variant="dangerTrigger"
          disabled={st.lifecycle === 'STOPPING'}
          onClick={() => setModal('stop')}
        >
          {t('live.stopStreaming')}
        </Button>
      ) : (
        <Button
          size="top"
          variant="primary"
          disabled={st.destinations.length === 0 || ended || !st.lease?.mine}
          onClick={() => setModal('go')}
        >
          {t('live.goLive')}
        </Button>
      )}
      {modal === 'go' && <GoLiveModal onClose={() => setModal(null)} />}
      {modal === 'stop' && (
        <StopModal
          destinations={liveDests.map((d) => ({
            id: d.id,
            platform: platformName(d),
            pageName: d.label,
            elapsed: fmtElapsed(
              st.observed?.destinations[d.id]?.sendingSince
                ? Date.parse(st.observed.destinations[d.id]!.sendingSince!)
                : null,
              now,
            ),
            sending: ['SENDING', 'LIVE_CONFIRMED'].includes(
              st.observed?.destinations[d.id]?.state ?? '',
            ),
            statusText: t('stop.notSending'),
          }))}
          onKeep={() => setModal(null)}
          onStop={() => {
            setModal(null);
            void rt.stopSending();
          }}
        />
      )}
    </>
  );
}

/** Start confirmation (SPEC §9.6): Cancel has initial focus; Enter never confirms. */
function GoLiveModal({ onClose }: { onClose: () => void }) {
  const rt = studioRuntime();
  const st = useStore(rt);
  const cancel = useRef<HTMLButtonElement>(null);
  // Starts from Preparation's choice; a destination without a key cannot start (B§16.4).
  const [chosen, setChosen] = useState<string[]>(
    st.destinations
      .filter((d) => st.selectedDestinationIds.includes(d.id) && rt.destinationHasKey(d))
      .map((d) => d.id),
  );
  const [record, setRecord] = useState(false);
  const toggle = (id: string) =>
    setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  const n = chosen.length;
  return (
    <Modal
      title={t('go.title')}
      onDismiss={onClose}
      initialFocus={cancel}
      actions={
        <>
          <Button ref={cancel} variant="secondary" onClick={onClose}>
            {t('go.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={n === 0}
            onClick={() => {
              onClose();
              void rt.goLive(chosen, record);
            }}
          >
            {n === 1 ? t('go.confirmOne') : t('go.confirm', { count: n })}
          </Button>
        </>
      }
    >
      <ul className={s.goList}>
        {st.destinations.map((d) => (
          <li key={d.id} className={s.goRow}>
            <label className={s.goLabel}>
              <input
                type="checkbox"
                checked={chosen.includes(d.id)}
                disabled={!rt.destinationHasKey(d)}
                onChange={() => toggle(d.id)}
              />
              <b>
                {platformName(d)} · {d.label}
              </b>
            </label>
            {!rt.destinationHasKey(d) && <span className={s.goWarn}>{t('go.noKey')}</span>}
            {d.autoPublishesOnIngest !== 'no' && (
              <span className={s.goWarn}>{t('go.publicWarning')}</span>
            )}
          </li>
        ))}
      </ul>
      <label className={s.goLabel}>
        <input type="checkbox" checked={record} onChange={() => setRecord((r) => !r)} />
        <span>{t('go.record', { gb: st.profile === 'full_hd' ? '2.7' : '1.8' })}</span>
      </label>
      <p className={s.goMeta}>{t('go.meta', { profile: PROFILE_SIZE[st.profile].label })}</p>
    </Modal>
  );
}
