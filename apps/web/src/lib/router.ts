/** Tiny pathname router; the app has only a handful of routes (SPEC §9.1). */
const listeners = new Set<() => void>();
window.addEventListener('popstate', () => listeners.forEach((l) => l()));

export const router = {
  get: () => window.location.pathname,
  subscribe: (fn: () => void) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  go: (path: string, replace = false) => {
    if (replace) history.replaceState(null, '', path);
    else history.pushState(null, '', path);
    listeners.forEach((l) => l());
  },
};
