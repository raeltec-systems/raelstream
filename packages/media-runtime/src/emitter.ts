/** Minimal observable state holder used by media controllers (kept outside React, SPEC §10.1). */
export class Observable<S> {
  private listeners = new Set<() => void>();
  constructor(protected state: S) {}
  get snapshot(): S {
    return this.state;
  }
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  protected set(patch: Partial<S>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }
}
