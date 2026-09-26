import { Button, Card, Segmented, StatusDot } from '@raelstream/ui';
import { t } from '@raelstream/i18n';
import type { Profile } from '@raelstream/contracts';
import { useStore } from '../../lib/useStore.js';
import { studioRuntime } from '../runtime.js';
import s from './steps.module.css';

const RANK: Record<Profile, number> = { reliable_hd: 1, full_hd: 2 };

/** Preparation → Uplink test (SPEC §11.3): measure the church upload, then pick the profile. */
export function UplinkStep() {
  const rt = studioRuntime();
  const st = useStore(rt);
  const u = st.uplink;
  const offer = u.result?.offer ?? null;
  const offerRank = offer === 'full_hd' ? 2 : offer === 'reliable_hd' ? 1 : 0;
  const aboveOffer = offer !== null && RANK[st.profile] > offerRank;
  const busy = u.status === 'running';
  const sending = rt.isLive || st.contribution === 'sending';

  return (
    <>
      <h1 className="rs-h1">{t('prep.uplink.title')}</h1>
      <p className={s.muted}>{t('prep.uplink.body')}</p>
      <Card>
        <div className={s.row}>
          <Button
            variant="primary"
            disabled={busy || sending}
            onClick={() => void rt.runUplinkTest()}
          >
            {busy
              ? t('prep.uplink.running')
              : u.result
                ? t('prep.uplink.again')
                : t('prep.uplink.run')}
          </Button>
          {u.progressMbps !== null && (
            <span className={s.mono} data-testid="uplink-mbps">
              {t('prep.uplink.mbps', { mbps: u.progressMbps.toFixed(1) })}
            </span>
          )}
        </div>
        {sending && <p className={s.muted}>{t('prep.uplink.notWhileSending')}</p>}
        {u.status === 'error' && <p className={s.warn}>{t('prep.uplink.failed')}</p>}
        {u.result && (
          <div className={s.row}>
            <StatusDot
              tone={offer === 'full_hd' ? 'ready' : offer === 'reliable_hd' ? 'ready' : 'standby'}
            />
            <span data-testid="uplink-offer">{t(`prep.uplink.offer.${u.result.offer}`)}</span>
          </div>
        )}
        {!u.result && u.status !== 'running' && (
          <p className={s.warn}>{t('prep.uplink.notMeasured')}</p>
        )}
        <p className={s.muted}>{t('prep.uplink.dataUse')}</p>
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
        {aboveOffer && <p className={s.warn}>{t('prep.uplink.aboveOffer')}</p>}
      </Card>
    </>
  );
}
