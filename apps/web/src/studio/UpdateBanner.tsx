import { Banner, Button } from '@raelstream/ui';
import { t } from '@raelstream/i18n';
import { useUpdateAvailable } from '../lib/update.js';
import { useStore } from '../lib/useStore.js';
import { studioRuntime } from './runtime.js';

/** "Update available": offered only when no service is live; never applied mid-service (A43). */
export function UpdateBanner() {
  const available = useUpdateAvailable();
  const rt = studioRuntime();
  useStore(rt);
  if (!available || rt.isLive) return null;
  return (
    <Banner
      compact
      tone="standby"
      title={t('update.title')}
      actions={
        <Button size="dense" variant="primary" onClick={() => window.location.reload()}>
          {t('update.reload')}
        </Button>
      }
    >
      {t('update.body')}
    </Banner>
  );
}
