import { useRef, useState } from 'react';
import { Banner, Button, Modal } from '@raelstream/ui';
import { t } from '@raelstream/i18n';
import { useStore } from '../lib/useStore.js';
import { studioRuntime } from './runtime.js';

/**
 * Read-only tab (A33): someone else holds the studio. Offer an explicit, confirmed take-over when this
 * account may take over; otherwise explain that the owner can.
 */
export function LeaseBanner({ compact = false }: { compact?: boolean }) {
  const rt = studioRuntime();
  const st = useStore(rt);
  const [confirm, setConfirm] = useState(false);
  const cancel = useRef<HTMLButtonElement>(null);
  if (!st.lease || st.lease.mine) return null;
  const who = st.lease.holderIsMe
    ? t('lease.anotherTab')
    : (st.lease.holderName ?? t('lease.someone'));
  return (
    <>
      <Banner
        compact={compact}
        tone="standby"
        title={t('lease.title', { who })}
        actions={
          st.lease.canTakeOver ? (
            <Button size="dense" variant="primary" onClick={() => setConfirm(true)}>
              {t('lease.takeOver')}
            </Button>
          ) : undefined
        }
      >
        {st.lease.canTakeOver ? t('lease.body') : t('lease.askOwner')}
      </Banner>
      {confirm && (
        <Modal
          title={t('lease.confirmTitle')}
          onDismiss={() => setConfirm(false)}
          initialFocus={cancel}
          actions={
            <>
              <Button ref={cancel} onClick={() => setConfirm(false)}>
                {t('go.cancel')}
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  setConfirm(false);
                  void rt.takeOver();
                }}
              >
                {t('lease.confirm')}
              </Button>
            </>
          }
        >
          <p>{t('lease.confirmBody', { who })}</p>
        </Modal>
      )}
    </>
  );
}
