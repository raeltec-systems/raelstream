/** Fixed-window in-memory limiter; sufficient for one private deployment (no Redis, B§22.1). */
export class RateLimiter {
  private hits = new Map<string, { n: number; resetAt: number }>();
  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}
  allow(key: string, now = Date.now()): boolean {
    const h = this.hits.get(key);
    if (!h || h.resetAt <= now) {
      this.hits.set(key, { n: 1, resetAt: now + this.windowMs });
      if (this.hits.size > 10_000) this.sweep(now);
      return true;
    }
    h.n += 1;
    return h.n <= this.limit;
  }
  private sweep(now: number): void {
    for (const [k, v] of this.hits) if (v.resetAt <= now) this.hits.delete(k);
  }
}
