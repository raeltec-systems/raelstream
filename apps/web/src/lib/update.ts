import { useEffect, useState } from 'react';

declare const __RS_APP_VERSION__: string;
export const APP_VERSION = __RS_APP_VERSION__;

/**
 * A new version was deployed while this page was open (SPEC §14.3 decision, A43). Deploys refuse to run
 * during a service, so this only tells the operator to reload before the next one; the page never
 * reloads itself.
 */
export function useUpdateAvailable(): boolean {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    if (APP_VERSION === 'dev') return;
    const check = () =>
      void fetch('/api/health', { credentials: 'same-origin' })
        .then((r) => (r.ok ? r.json() : null))
        .then((h: { version?: string } | null) => {
          if (h?.version && h.version !== 'dev' && h.version !== APP_VERSION) setAvailable(true);
        })
        .catch(() => undefined);
    check();
    const id = setInterval(check, 60_000);
    return () => clearInterval(id);
  }, []);
  return available;
}
