import { lazy, Suspense, useSyncExternalStore } from 'react';
import { router } from './lib/router.js';

const InviteApp = lazy(() => import('./auth/InviteApp.js').then((m) => ({ default: m.InviteApp })));
const CameraApp = lazy(() => import('./cam/CameraApp.js').then((m) => ({ default: m.CameraApp })));
const StudioApp = lazy(() =>
  import('./studio/StudioApp.js').then((m) => ({ default: m.StudioApp })),
);

export function App() {
  const path = useSyncExternalStore(router.subscribe, router.get);
  if (path === '/') {
    router.go('/studio', true);
    return null;
  }
  return (
    <Suspense fallback={null}>
      {path.startsWith('/cam') ? (
        <CameraApp />
      ) : path.startsWith('/invite') ? (
        <InviteApp />
      ) : (
        <StudioApp path={path} />
      )}
    </Suspense>
  );
}
