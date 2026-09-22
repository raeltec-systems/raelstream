import { useRef } from 'react';
import { t } from '@raelstream/i18n';
import { Button } from './Button.js';
import { Modal } from './Modal.js';
import { StatusDot } from './Status.js';
import s from './StopModal.module.css';

export interface LiveDestination {
  id: string;
  platform: string;
  pageName: string;
  elapsed: string;
}

/** Stop confirmation (SPEC I-11, design Stop modal). Keep streaming gets initial focus; Enter never confirms. */
export function StopModal({
  destinations,
  onKeep,
  onStop,
}: {
  destinations: LiveDestination[];
  onKeep: () => void;
  onStop: () => void;
}) {
  const keep = useRef<HTMLButtonElement>(null);
  const n = destinations.length;
  const stopLabel =
    n === 1
      ? t('stop.confirmOne', { platform: destinations[0]!.platform })
      : n === 2
        ? t('stop.confirmBoth')
        : t('stop.confirmAll');
  return (
    <Modal
      title={n === 1 ? t('stop.titleOne') : t('stop.title', { count: n })}
      onDismiss={onKeep}
      initialFocus={keep}
      actions={
        <>
          <Button ref={keep} variant="secondary" className={s.keep} onClick={onKeep}>
            {t('stop.keep')}
          </Button>
          <Button variant="destructive" onClick={onStop}>
            {stopLabel}
          </Button>
        </>
      }
    >
      <ul className={s.list}>
        {destinations.map((d) => (
          <li key={d.id} className={s.row}>
            <StatusDot tone="live" />
            <b className={s.name}>
              {d.platform} · {d.pageName}
            </b>
            <span className="rs-mono">{t('stop.liveTimer', { elapsed: d.elapsed })}</span>
          </li>
        ))}
      </ul>
      <p className={s.body}>{t('stop.body')}</p>
    </Modal>
  );
}
