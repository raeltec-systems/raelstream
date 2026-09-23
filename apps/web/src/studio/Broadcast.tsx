import { useRef, useState } from 'react';
import type { DestinationSummary, ObservedDestination } from '@raelstream/contracts';
import { Banner, Button, Modal, Pill, StatusDot, StopModal, type Tone } from '@raelstream/ui';
import { t, type MessageKey } from '@raelstream/i18n';
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

function platformName(d: DestinationSummary): string {
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
          <Button size="dense" variant="primary" onClick={() => window.location.assign('/studio')}>
            {t('banner.newService')}
          </Button>
        }
      >
        {t('banner.endedBody')}
      </Banner>
    );
  }
  if (st.lifecycle === 'RECOVERING') {
    return (
      <Banner compact tone="standby" title={t('banner.slateTitle')}>
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
  const [chosen, setChosen] = useState<string[]>(st.destinations.map((d) => d.id));
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
              void rt.goLive(chosen);
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
                onChange={() => toggle(d.id)}
              />
              <b>
                {platformName(d)} · {d.label}
              </b>
            </label>
            {d.autoPublishesOnIngest !== 'no' && (
              <span className={s.goWarn}>{t('go.publicWarning')}</span>
            )}
          </li>
        ))}
      </ul>
      <p className={s.goMeta}>{t('go.meta', { profile: PROFILE_SIZE[st.profile].label })}</p>
    </Modal>
  );
}
