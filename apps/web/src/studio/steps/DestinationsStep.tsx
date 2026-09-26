import { useState } from 'react';
import type { DestinationSummary } from '@raelstream/contracts';
import { Card, SecretField, StatusDot } from '@raelstream/ui';
import { t } from '@raelstream/i18n';
import { ApiFailure } from '../../lib/api.js';
import { useStore } from '../../lib/useStore.js';
import { studioRuntime } from '../runtime.js';
import { platformName } from '../Broadcast.js';
import s from './steps.module.css';

/**
 * Preparation → Destinations (SPEC §13): pick where this service goes, paste Facebook's key for this
 * service (I-13), and see what each platform does when media arrives (I-14).
 */
export function DestinationsStep() {
  const rt = studioRuntime();
  const st = useStore(rt);
  return (
    <>
      <h1 className="rs-h1">{t('prep.dest.title')}</h1>
      <p className={s.muted}>{t('prep.dest.body')}</p>
      {st.destinations.length === 0 && (
        <Card>
          <p className={s.muted}>{t('dest.noneConfigured')}</p>
        </Card>
      )}
      {st.destinations.map((d) => (
        <DestinationCard key={d.id} d={d} />
      ))}
    </>
  );
}

function DestinationCard({ d }: { d: DestinationSummary }) {
  const rt = studioRuntime();
  const st = useStore(rt);
  const [error, setError] = useState<string | null>(null);
  const [warn, setWarn] = useState<string | null>(null);
  const selected = st.selectedDestinationIds.includes(d.id);
  const sd = st.sessionDestinations.find((x) => x.destinationId === d.id);
  const hasKey = rt.destinationHasKey(d);
  const live = rt.isLive;

  async function paste(key: string) {
    setError(null);
    setWarn(null);
    try {
      const r = await rt.pasteSessionKey(d.id, key);
      if (r.sameAsLast) setWarn(t('prep.dest.sameAsLast'));
    } catch (e) {
      setError(e instanceof ApiFailure ? e.message : t('prep.dest.keyFailed'));
    }
  }

  return (
    <Card ring={selected && !hasKey ? 'standby' : undefined}>
      <label className={s.row}>
        <input
          type="checkbox"
          checked={selected}
          disabled={live}
          onChange={() => rt.toggleDestination(d.id)}
          aria-label={t('prep.dest.use', { name: `${platformName(d)} · ${d.label}` })}
        />
        <StatusDot tone={!selected ? 'off' : hasKey ? 'ready' : 'standby'} />
        <span className={s.headTitle} style={{ flex: 1 }}>
          {platformName(d)} · {d.label}
        </span>
        {d.eventReference && <span className={s.muted}>{d.eventReference}</span>}
      </label>
      {d.keyMode === 'per_event' ? (
        <SecretField
          label={t('prep.dest.fbKey')}
          masked={sd?.sessionKeyPresent ? `••••${sd.sessionKeyLast4}` : null}
          placeholder={t('prep.dest.fbKeyNeeded')}
          helper={warn ?? t('prep.dest.fbKeyHelp')}
          error={error}
          pasteLabel={sd?.sessionKeyPresent ? t('prep.dest.replace') : t('prep.dest.paste')}
          onPaste={(v) => void paste(v)}
        />
      ) : (
        <p className={s.muted}>
          {d.keyLast4 ? t('prep.dest.savedKey', { last4: d.keyLast4 }) : t('prep.dest.noKey')}
        </p>
      )}
      <p className={d.autoPublishesOnIngest === 'no' ? s.muted : s.warn}>
        {d.autoPublishesOnIngest === 'no'
          ? d.platform === 'youtube'
            ? t('prep.dest.ytManual')
            : t('prep.dest.fbManual')
          : t('prep.dest.autoPublic', { platform: platformName(d) })}
      </p>
      {d.watchUrl && (
        <a className={s.link} href={d.watchUrl} target="_blank" rel="noreferrer noopener">
          {t('prep.dest.openWatch')}
        </a>
      )}
    </Card>
  );
}
