import { useSyncExternalStore } from 'react';

export interface Store<S> {
  subscribe: (fn: () => void) => () => void;
  readonly snapshot: S;
}

export function useStore<S>(store: Store<S>): S {
  return useSyncExternalStore(store.subscribe, () => store.snapshot);
}
