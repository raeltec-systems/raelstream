import { useCallback, useEffect, useState } from 'react';
import type { SessionSnapshot } from '@raelstream/contracts';
import { api, setCsrf } from '../lib/api.js';
import { router } from '../lib/router.js';
import { SignIn, type Me } from '../auth/SignIn.js';
import { studioRuntime } from './runtime.js';
import { Preparation } from './Preparation.js';
import { Live } from './Live.js';
import { Home } from './Home.js';
import { Settings } from './Settings.js';
import { ServiceReport } from './Report.js';

/** Studio shell: sign-in gate → service home / settings → Preparation / Live for the active service. */
export function StudioApp({ path }: { path: string }) {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [session, setSession] = useState<SessionSnapshot | null | undefined>(undefined);

  const loadMe = useCallback(() => {
    api<Me>('GET', '/api/auth/me')
      .then((m) => {
        setCsrf(m.csrf);
        setMe(m);
      })
      .catch(() => setMe(null));
  }, []);

  useEffect(loadMe, [loadMe]);

  // Look for an active service on sign-in and whenever we are back on the home screen: another
  // person may have started one in the meantime (SPEC §9.10). Home also polls while it is shown.
  const hasSession = !!session;
  const findActive = useCallback(() => {
    api<SessionSnapshot | null>('GET', '/api/sessions/active')
      .then((snap) => {
        setSession(snap);
        if (snap) void studioRuntime().attach(snap);
      })
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!me || hasSession) return;
    findActive();
    const timer = setInterval(findActive, 5000);
    return () => clearInterval(timer);
  }, [me, hasSession, path, findActive]);

  async function signOut() {
    await api('POST', '/api/auth/logout').catch(() => undefined);
    setMe(null);
    setSession(undefined);
  }

  if (me === undefined) return null;
  if (me === null) return <SignIn onDone={loadMe} />;
  if (path.startsWith('/studio/settings') && me.role === 'owner') return <Settings me={me} />;
  const report = /^\/studio\/report\/([0-9a-f-]{36})$/.exec(path);
  if (report) return <ServiceReport id={report[1]!} />;
  if (session === undefined) return null;
  if (session === null)
    return (
      <Home
        me={me}
        onSignOut={() => void signOut()}
        onStarted={(snap) => {
          setSession(snap);
          void studioRuntime().attach(snap);
          router.go('/studio');
        }}
      />
    );
  return path.startsWith('/studio/live') ? (
    <Live />
  ) : (
    <Preparation operator={me.name} role={me.role} onSignOut={() => void signOut()} />
  );
}
